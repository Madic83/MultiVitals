import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import './App.css'
import {
  ALARM_LIMITS,
  useSimulationSync,
} from './simulation'
import type {
  AlarmLevel,
  BloodGasSampleType,
  BloodGasValues,
  MediaChannel,
  MediaType,
  MonitorParamKey,
  RhythmPreset,
  SimulationState,
  VentilatorSettings,
  Vitals,
} from './simulation'

type ViewId = 'dashboard' | 'instructor' | 'intellivue' | 'corpuls3' | 'x2' | 'x3' | 'media-xray' | 'media-lab' | 'media-ultrasound' | 'flow-i' | 'hamilton-t1'
type UserRole = 'instructor' | 'participant'

interface UserAccount {
  username: string
  password: string
  role: UserRole
  displayName: string
}

interface Session {
  username: string
  displayName: string
  role: UserRole
  sessionId: string
}

interface WakeLockSentinelLike {
  released?: boolean
  release: () => Promise<void>
}

interface AcknowledgedAlarm {
  id: string
  acknowledgedAt: number
  triggerValue: number | null // e.g., the SpO2 % or HR bpm that triggered the alarm
}


interface NoSleepLike {
  enable: () => Promise<void>
  disable: () => void
}

const useKeepScreenAwake = () => {
  useEffect(() => {
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<WakeLockSentinelLike>
      }
    }).wakeLock
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const shouldPreferNoSleep = isIOS

    let wakeLock: WakeLockSentinelLike | null = null
    let noSleep: NoSleepLike | null = null
    let noSleepEnabled = false

    const ensureNoSleep = async () => {
      if (noSleep) {
        return noSleep
      }

      const module = await import('nosleep.js')
      const NoSleepCtor = (module.default ?? module) as unknown as new () => NoSleepLike
      noSleep = new NoSleepCtor()
      return noSleep
    }

    const enableNoSleepFallback = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      try {
        const noSleepInstance = await ensureNoSleep()
        if (!noSleepEnabled) {
          await noSleepInstance.enable()
          noSleepEnabled = true
        }
      } catch {
        // iOS Safari can reject until interaction; we'll retry on user input.
      }
    }

    const disableNoSleepFallback = () => {
      if (noSleep && noSleepEnabled) {
        noSleep.disable()
        noSleepEnabled = false
      }
    }

    const requestWakeLock = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      if (!wakeLockApi) {
        await enableNoSleepFallback()
        return
      }

      try {
        if (!wakeLock || wakeLock.released) {
          wakeLock = await wakeLockApi.request('screen')
        }

        if (shouldPreferNoSleep) {
          await enableNoSleepFallback()
        } else {
          disableNoSleepFallback()
        }
      } catch {
        // Some browsers require fresh user interaction before acquiring wake lock.
        await enableNoSleepFallback()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock()
      } else {
        if (wakeLock && !wakeLock.released) {
          void wakeLock.release()
          wakeLock = null
        }
        disableNoSleepFallback()
      }
    }

    const handleUserInteraction = () => {
      void requestWakeLock()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pointerdown', handleUserInteraction, { passive: true })
    window.addEventListener('keydown', handleUserInteraction)
    window.addEventListener('touchstart', handleUserInteraction, { passive: true })

    void requestWakeLock()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pointerdown', handleUserInteraction)
      window.removeEventListener('keydown', handleUserInteraction)
      window.removeEventListener('touchstart', handleUserInteraction)

      if (wakeLock) {
        void wakeLock.release()
        wakeLock = null
      }

      disableNoSleepFallback()
      noSleep = null
    }
  }, [])
}

const accounts: UserAccount[] = [
  {
    username: 'Madic',
    password: 'Bertil83',
    role: 'instructor',
    displayName: 'Madic',
  },
  {
    username: 'AlexDVO',
    password: 'AlexDVO',
    role: 'instructor',
    displayName: 'AlexDVO',
  },
  {
    username: 'instruktor',
    password: 'sim123',
    role: 'instructor',
    displayName: 'instruktor',
  },
]

const views: Array<{
  id: ViewId
  title: string
  subtitle: string
  device: string
  requiresInstructor?: boolean
}> = [
  {
    id: 'instructor',
    title: 'Instruktör',
    subtitle: 'Styr vitalparametrar, rytm, larm samt media',
    device: 'Desktop',
    requiresInstructor: true,
  },
  {
    id: 'intellivue',
    title: 'Intellivue mx450',
    subtitle: 'Monitorinspirerad overvakningsvy for bedside',
    device: 'iPad',
  },
  {
    id: 'corpuls3',
    title: 'Corpuls 3',
    subtitle: 'Transport- och akutmonitor inspirerad av corpuls-stil',
    device: 'Desktop/Tablet',
  },
  {
    id: 'x2',
    title: 'Patientmonitor X2',
    subtitle: 'Kompakt iPhone-vy med stora primarvarder',
    device: 'iPhone',
  },
  {
    id: 'x3',
    title: 'Patientmonitor X3',
    subtitle: 'iPhone-vy med fler samtidiga parametrar',
    device: 'iPhone',
  },
  {
    id: 'media-xray',
    title: 'Röntgen',
    subtitle: 'Visar endast röntgenmedia vald av instruktör',
    device: 'TV/Projektor',
  },
  {
    id: 'media-lab',
    title: 'Provsvar och blodgas',
    subtitle: 'Visar endast provsvar och blodgassvar',
    device: 'TV/Projektor',
  },
  {
    id: 'media-ultrasound',
    title: 'Ultraljud',
    subtitle: 'Visar endast ultraljudsmedia',
    device: 'TV/Projektor',
  },
  {
    id: 'flow-i',
    title: 'Flow-I',
    subtitle: 'Ventilatorinspirerad narkosapparatvy',
    device: 'Desktop/TV',
  },
  {
    id: 'hamilton-t1',
    title: 'Hamilton T1',
    subtitle: 'Transportventilator inspirerad monitorvy',
    device: 'Desktop/TV',
  },
]

const validViews = new Set<ViewId>(views.map((view) => view.id).concat('dashboard'))

const getViewFromUrl = (): ViewId => {
  const params = new URLSearchParams(window.location.search)
  const value = params.get('view') as ViewId | null
  return value && validViews.has(value) ? value : 'dashboard'
}

const updateViewInUrl = (view: ViewId) => {
  try {
    const url = new URL(window.location.href)
    if (view === 'dashboard') {
      url.searchParams.delete('view')
    } else {
      url.searchParams.set('view', view)
    }
    window.history.replaceState({}, '', url)
  } catch {
    // Ignore URL sync failures in embedded/restricted browsers.
  }
}


const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const MMHG_TO_KPA = 0.133322
const WAVE_SYNC_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

const XRAY_SUBDURAL_PRESET_VALUE = 'preset-xray-akut-subdural-hematom'
const XRAY_RADIUS_ULNA_PRESET_VALUE = 'preset-xray-radius-ulna-fraktur'
const XRAY_SUBDURAL_PRESET = {
  title: 'Akut subdural hematom',
  type: 'image' as const,
  // Uses the user-provided file copied to public/SubduralH.jpg.
  url: '/SubduralH.jpg',
}
const XRAY_RADIUS_ULNA_PRESET = {
  title: 'Radius och Ulna fraktur',
  type: 'image' as const,
  // Uses the user-provided file copied to public/radiusx.jpeg.
  url: '/radiusx.jpeg',
}

const readFileAsDataUrl = (file: File): Promise<string> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Kunde inte lasa filen.'))
      }
    }
    reader.onerror = () => reject(new Error('Kunde inte lasa filen.'))
    reader.readAsDataURL(file)
  })
)

function getOutOfRange(value: string | number, ref: string): 'high' | 'low' | 'normal' {
  const num = parseFloat(String(value))
  if (isNaN(num)) return 'normal'
  const ltMatch = ref.match(/^<([\d.]+)$/)
  if (ltMatch) return num >= parseFloat(ltMatch[1]) ? 'high' : 'normal'
  const tillMatch = ref.match(/^([+-]?[\d.]+)\s+till\s+([+-]?[\d.]+)$/)
  if (tillMatch) {
    const lo = parseFloat(tillMatch[1]); const hi = parseFloat(tillMatch[2])
    if (num < lo) return 'low'; if (num > hi) return 'high'; return 'normal'
  }
  const rangeMatch = ref.match(/^([\d.]+)-([\d.]+)$/)
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]); const hi = parseFloat(rangeMatch[2])
    if (num < lo) return 'low'; if (num > hi) return 'high'; return 'normal'
  }
  return 'normal'
}

type BloodGasSection = 'Syrabas' | 'Oxygenering' | 'Elektrolyt och metabol'

type BloodGasField = {
  key: keyof BloodGasValues
  label: string
  unit: string
  ref: string
  section: BloodGasSection
}

const ARTERIAL_BLOOD_GAS_FIELDS: BloodGasField[] = [
  { key: 'pH', label: 'pH', unit: '', ref: '7.35-7.45', section: 'Syrabas' },
  { key: 'pCO2', label: 'pCO2', unit: 'kPa', ref: '4.7-6.0', section: 'Syrabas' },
  { key: 'pO2', label: 'pO2', unit: 'kPa', ref: '10.7-13.3', section: 'Syrabas' },
  { key: 'SBEc', label: 'SBEc', unit: 'mmol/L', ref: '-3 till +3', section: 'Syrabas' },
  { key: 'sO2', label: 'sO2', unit: '%', ref: '95-100', section: 'Oxygenering' },
  { key: 'Hb', label: 'Hb', unit: 'g/L', ref: '120-170', section: 'Oxygenering' },
  { key: 'cK', label: 'cK', unit: 'mmol/L', ref: '3.5-5.0', section: 'Elektrolyt och metabol' },
  { key: 'cNa', label: 'cNa', unit: 'mmol/L', ref: '135-145', section: 'Elektrolyt och metabol' },
  { key: 'cCa', label: 'cCa', unit: 'mmol/L', ref: '1.12-1.30', section: 'Elektrolyt och metabol' },
  { key: 'cCL', label: 'cCL', unit: 'mmol/L', ref: '98-107', section: 'Elektrolyt och metabol' },
  { key: 'cGlu', label: 'cGlu', unit: 'mmol/L', ref: '4.0-7.0', section: 'Elektrolyt och metabol' },
  { key: 'cLac', label: 'cLac', unit: 'mmol/L', ref: '<2.0', section: 'Elektrolyt och metabol' },
]

const VENOUS_BLOOD_GAS_FIELDS: BloodGasField[] = [
  { key: 'pH', label: 'pH', unit: '', ref: '7.31-7.41', section: 'Syrabas' },
  { key: 'pCO2', label: 'pCO2', unit: 'kPa', ref: '5.6-6.8', section: 'Syrabas' },
  { key: 'pO2', label: 'pO2', unit: 'kPa', ref: '4.0-6.7', section: 'Syrabas' },
  { key: 'SBEc', label: 'SBEc', unit: 'mmol/L', ref: '-3 till +3', section: 'Syrabas' },
  { key: 'sO2', label: 'sO2', unit: '%', ref: '60-85', section: 'Oxygenering' },
  { key: 'Hb', label: 'Hb', unit: 'g/L', ref: '120-170', section: 'Oxygenering' },
  { key: 'cK', label: 'cK', unit: 'mmol/L', ref: '3.5-5.0', section: 'Elektrolyt och metabol' },
  { key: 'cNa', label: 'cNa', unit: 'mmol/L', ref: '135-145', section: 'Elektrolyt och metabol' },
  { key: 'cCa', label: 'cCa', unit: 'mmol/L', ref: '1.12-1.30', section: 'Elektrolyt och metabol' },
  { key: 'cCL', label: 'cCL', unit: 'mmol/L', ref: '98-107', section: 'Elektrolyt och metabol' },
  { key: 'cGlu', label: 'cGlu', unit: 'mmol/L', ref: '4.0-7.0', section: 'Elektrolyt och metabol' },
  { key: 'cLac', label: 'cLac', unit: 'mmol/L', ref: '<2.0', section: 'Elektrolyt och metabol' },
]

const getBloodGasFields = (sampleType: BloodGasSampleType): BloodGasField[] => (
  sampleType === 'venous' ? VENOUS_BLOOD_GAS_FIELDS : ARTERIAL_BLOOD_GAS_FIELDS
)

const BloodGasValuesGrid = ({
  values,
  sampleType,
  compact = false,
  generatedAt,
}: {
  values: BloodGasValues
  sampleType: BloodGasSampleType
  compact?: boolean
  generatedAt?: number
}) => {
  const fields = getBloodGasFields(sampleType)
  const title = sampleType === 'venous' ? 'Venös blodgas' : 'Arteriell blodgas'

  return (
    <div className={`bloodgas-report${compact ? ' bloodgas-report--compact' : ''}`} aria-label="Blodgasvarden">
      <div className="bloodgas-report-head">
        <strong>{title}</strong>
        {generatedAt ? <span>{new Date(generatedAt).toLocaleString('sv-SE')}</span> : null}
      </div>
      <table className="bloodgas-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Resultat</th>
            <th>Enhet</th>
            <th>Referens</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const oor = getOutOfRange(values[field.key], field.ref)
            return (
              <tr key={field.key} className={oor !== 'normal' ? 'bloodgas-row-abnormal' : ''}>
                <td>{field.label}</td>
                <td className={`bloodgas-table-value${oor !== 'normal' ? ' bloodgas-value-abnormal' : ''}`}>
                  {values[field.key]}{oor === 'high' ? ' ↑' : oor === 'low' ? ' ↓' : ''}
                </td>
                <td>{field.unit || '-'}</td>
                <td>{field.ref}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const rhythmPatterns: Record<RhythmPreset, number[]> = {
  sinus: [0.52, 0.5, 0.48, 0.44, 0.58, 0.08, 0.74, 0.5, 0.49, 0.52],
  afib: [0.57, 0.5, 0.42, 0.63, 0.54, 0.38, 0.21, 0.7, 0.49, 0.59],
  flutter: [0.52, 0.44, 0.54, 0.46, 0.55, 0.47, 0.54, 0.08, 0.74, 0.5],
  svt: [0.52, 0.51, 0.49, 0.56, 0.08, 0.76, 0.44, 0.5, 0.48, 0.52],
  vtach: [0.5, 0.2, 0.8, 0.26, 0.75, 0.32, 0.68, 0.36, 0.64, 0.4],
  vfib: [0.48, 0.62, 0.34, 0.7, 0.28, 0.64, 0.4, 0.76, 0.31, 0.56],
  asystole: [0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56],
  pea: [0.56, 0.53, 0.57, 0.55, 0.6, 0.48, 0.67, 0.53, 0.56, 0.55],
  // Acute ECG conditions
  stemi_ant: [0.52, 0.50, 0.47, 0.44, 0.54, 0.10, 0.64, 0.42, 0.50, 0.52],
  stemi_inf: [0.52, 0.50, 0.47, 0.44, 0.54, 0.10, 0.64, 0.42, 0.50, 0.52],
  stemi_lat: [0.52, 0.50, 0.47, 0.44, 0.54, 0.10, 0.64, 0.42, 0.50, 0.52],
  lbbb:      [0.52, 0.50, 0.49, 0.30, 0.18, 0.24, 0.56, 0.65, 0.73, 0.52],
  rbbb:      [0.52, 0.50, 0.48, 0.44, 0.57, 0.09, 0.46, 0.52, 0.43, 0.52],
  avblock3:  [0.54, 0.50, 0.54, 0.52, 0.54, 0.22, 0.72, 0.54, 0.50, 0.54],
  wpw:       [0.52, 0.50, 0.48, 0.42, 0.34, 0.10, 0.71, 0.50, 0.49, 0.52],
}

const RHYTHM_LABELS: Record<RhythmPreset, string> = {
  sinus: 'Sinus',
  afib: 'FF',
  flutter: 'Flutter',
  svt: 'SVT',
  vtach: 'VT',
  vfib: 'VF',
  asystole: 'Asystoli',
  pea: 'PEA',
  stemi_ant: 'STEMI Ant',
  stemi_inf: 'STEMI Inf',
  stemi_lat: 'STEMI Lat',
  lbbb: 'VGS',
  rbbb: 'HGS',
  avblock3: 'AV-block III',
  wpw: 'WPW',
}

const RHYTHM_OPTIONS: RhythmPreset[] = ['sinus', 'afib', 'svt', 'vtach', 'vfib', 'asystole', 'pea']
const ACUTE_RHYTHM_OPTIONS: RhythmPreset[] = ['stemi_ant', 'stemi_inf', 'stemi_lat', 'lbbb', 'rbbb', 'avblock3', 'wpw']

/** Tooltip/description for each acute rhythm */
const ACUTE_RHYTHM_DESC: Partial<Record<RhythmPreset, string>> = {
  stemi_ant: 'ST-höjning V1–V4, patologiska Q-vågor',
  stemi_inf: 'ST-höjning II, III, aVF — reciprok depression I, aVL',
  stemi_lat: 'ST-höjning I, aVL, V5–V6 — reciprok V1–V2',
  lbbb: 'Bred QRS, M-mönster I/V5-V6, diskordant T',
  rbbb: 'RSR\' i V1, bred terminal S i I/V6',
  avblock3: 'Komplett AV-block — ventrikelfrekv. ~35/min, dissocierade P',
  wpw: 'Deltasvåg, kort PR, bred QRS',
}

type EcgLead = 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6'

const LEAD_AXIS_DEGREES: Record<EcgLead, number> = {
  I: 0,
  II: 60,
  III: 120,
  aVR: -150,
  aVL: -30,
  aVF: 90,
  V1: 110,
  V2: 95,
  V3: 70,
  V4: 40,
  V5: 20,
  V6: 5,
}

const RHYTHM_MEAN_AXIS: Record<RhythmPreset, number> = {
  sinus: 55,
  afib: 60,
  flutter: 65,
  svt: 70,
  vtach: 115,
  vfib: 45,
  asystole: 55,
  pea: 45,
  stemi_ant: 55,
  stemi_inf: 80,
  stemi_lat: 15,
  lbbb: -25,
  rbbb: 110,
  avblock3: 45,
  wpw: 55,
}

const PRECORDIAL_RS_PROGRESSION: Record<'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6', number> = {
  V1: -0.72,
  V2: -0.5,
  V3: -0.16,
  V4: 0.26,
  V5: 0.58,
  V6: 0.74,
}

const gaussian = (position: number, center: number, width: number): number => {
  const normalized = (position - center) / width
  return Math.exp(-0.5 * normalized * normalized)
}

const getEcgMorphologyMod = (elapsedSeconds: number, rate: number) => {
  const rrSeconds = 60 / clamp(rate, 30, 220)
  const beatIndex = Math.floor(elapsedSeconds / rrSeconds)
  const beatAlternans = beatIndex % 2 === 0 ? 1.018 : 0.982
  const respiratoryAmplitude = 1 + 0.03 * Math.sin(elapsedSeconds * Math.PI * 0.16)
  const phaseJitter =
    Math.sin(elapsedSeconds * Math.PI * 0.53) * 0.0022
    + Math.sin(elapsedSeconds * Math.PI * 1.11 + 0.6) * 0.0011

  return {
    amplitude: beatAlternans * respiratoryAmplitude,
    phase: phaseJitter,
  }
}

const triangleWave = (position: number): number => 1 - 4 * Math.abs((((position % 1) + 1) % 1) - 0.5)

const getEcgSample = (
  rhythm: RhythmPreset,
  elapsedSeconds: number,
  rate: number,
): number => {
  const beatsPerSecond = clamp(rate / 60, 0.5, 3.4)
  const shiftedPosition = elapsedSeconds * beatsPerSecond
  const beatPosition = ((shiftedPosition % 1) + 1) % 1
  const baselineDrift = Math.sin(elapsedSeconds * Math.PI * 0.38) * 0.0025
  const morphology = getEcgMorphologyMod(elapsedSeconds, rate)
  const modBeatPosition = ((beatPosition + morphology.phase) % 1 + 1) % 1
  const amp = morphology.amplitude

  // Delegate acute ECG patterns — function defined below, safe because JS hoists nothing,
  // but this module-level const IS initialized before any call at runtime.
  if (rhythm === 'stemi_ant' || rhythm === 'stemi_inf' || rhythm === 'stemi_lat' ||
      rhythm === 'lbbb' || rhythm === 'rbbb' || rhythm === 'avblock3' || rhythm === 'wpw') {
    return getAcuteEcgSample(rhythm as Parameters<typeof getAcuteEcgSample>[0], elapsedSeconds, rate)
  }

  if (rhythm === 'asystole') {
    const artifact = Math.sin(elapsedSeconds * Math.PI * 3.2) * 0.0012
    return clamp(0.56 + artifact, 0.05, 0.93)
  }

  if (rhythm === 'sinus') {
    const pWave = -0.052 * amp * gaussian(modBeatPosition, 0.185, 0.034)
    const prLift = -0.004 * gaussian(modBeatPosition, 0.27, 0.028)
    const qWave = 0.05 * amp * gaussian(modBeatPosition, 0.392, 0.0075)
    const rWave = -0.56 * amp * gaussian(modBeatPosition, 0.404, 0.0048)
    const sWave = 0.19 * amp * gaussian(modBeatPosition, 0.423, 0.0085)
    const stSegment = -0.003 * gaussian(modBeatPosition, 0.555, 0.032)
    const tWave = -0.105 * (0.97 + amp * 0.03) * gaussian(modBeatPosition, 0.72, 0.062)
    return clamp(0.565 + baselineDrift + pWave + prLift + qWave + rWave + sWave + stSegment + tWave, 0.04, 0.94)
  }

  if (rhythm === 'afib') {
    const irregularBeatPosition = ((modBeatPosition
      + Math.sin(elapsedSeconds * Math.PI * 1.7) * 0.014
      + Math.sin(elapsedSeconds * Math.PI * 0.9) * 0.01) % 1 + 1) % 1
    const fibrillation = Math.sin(elapsedSeconds * Math.PI * 15.5) * 0.009
    const fibrillationFine = Math.sin(elapsedSeconds * Math.PI * 31) * 0.004
    const qWave = 0.015 * amp * gaussian(irregularBeatPosition, 0.408, 0.011)
    const rWave = -0.29 * amp * gaussian(irregularBeatPosition, 0.422, 0.008)
    const sWave = 0.095 * amp * gaussian(irregularBeatPosition, 0.444, 0.014)
    const tWave = -0.06 * (0.98 + amp * 0.02) * gaussian(irregularBeatPosition, 0.68, 0.07)
    return clamp(0.55 + baselineDrift + fibrillation + fibrillationFine + qWave + rWave + sWave + tWave, 0.04, 0.94)
  }

  if (rhythm === 'flutter') {
    const flutterPosition = ((elapsedSeconds * 4.8) % 1 + 1) % 1
    const flutterWaves = triangleWave(flutterPosition) * 0.028 + triangleWave(flutterPosition + 0.22) * 0.016
    const qWave = 0.022 * amp * gaussian(modBeatPosition, 0.405, 0.010)
    const rWave = -0.3 * amp * gaussian(modBeatPosition, 0.418, 0.0075)
    const sWave = 0.105 * amp * gaussian(modBeatPosition, 0.442, 0.014)
    const tWave = -0.05 * (0.98 + amp * 0.02) * gaussian(modBeatPosition, 0.7, 0.065)
    return clamp(0.55 + baselineDrift - flutterWaves + qWave + rWave + sWave + tWave, 0.04, 0.94)
  }

  if (rhythm === 'svt') {
    const hiddenP = -0.012 * gaussian(modBeatPosition, 0.22, 0.018)
    const qWave = 0.02 * amp * gaussian(modBeatPosition, 0.405, 0.008)
    const rWave = -0.34 * amp * gaussian(modBeatPosition, 0.418, 0.0058)
    const sWave = 0.11 * amp * gaussian(modBeatPosition, 0.438, 0.0105)
    const tWave = -0.045 * (0.98 + amp * 0.02) * gaussian(modBeatPosition, 0.63, 0.052)
    return clamp(0.56 + baselineDrift + hiddenP + qWave + rWave + sWave + tWave, 0.04, 0.94)
  }

  if (rhythm === 'pea') {
    const beatIndex = Math.floor(shiftedPosition)
    const alternans = beatIndex % 2 === 0 ? 1 : 0.86
    const pWave = -0.01 * gaussian(modBeatPosition, 0.18, 0.028)
    const qWave = 0.015 * gaussian(modBeatPosition, 0.398, 0.011)
    const rWave = -0.23 * amp * gaussian(modBeatPosition, 0.414, 0.0115)
    const sWave = 0.095 * amp * gaussian(modBeatPosition, 0.448, 0.018)
    const stSegment = -0.004 * gaussian(modBeatPosition, 0.56, 0.04)
    const tWave = -0.04 * gaussian(modBeatPosition, 0.71, 0.08)
    const baselineMotion = Math.sin(elapsedSeconds * Math.PI * 0.28) * 0.004
    const activity = (pWave + qWave + rWave + sWave + stSegment + tWave) * alternans
    return clamp(0.57 + baselineDrift + baselineMotion + activity, 0.05, 0.93)
  }

  if (rhythm === 'vtach') {
    const initialShoulder = -0.09 * gaussian(beatPosition, 0.27, 0.032)
    const dominantR = -0.27 * gaussian(beatPosition, 0.36, 0.06)
    const notch = 0.055 * gaussian(beatPosition, 0.405, 0.013)
    const secondPeak = -0.1 * gaussian(beatPosition, 0.445, 0.03)
    const terminalS = 0.135 * gaussian(beatPosition, 0.56, 0.058)
    const lateSlur = 0.03 * gaussian(beatPosition, 0.63, 0.04)
    const discordantT = 0.065 * gaussian(beatPosition, 0.77, 0.085)
    const vtContour = Math.sin((beatPosition - 0.22) * Math.PI * 1.08) * 0.01
    return clamp(
      0.595
        + baselineDrift
        + initialShoulder
        + dominantR
        + notch
        + secondPeak
        + terminalS
        + lateSlur
        + discordantT
        + vtContour,
      0.04,
      0.94,
    )
  }

  if (rhythm === 'vfib') {
    const coarseChaos = Math.sin(elapsedSeconds * Math.PI * 7.2) * 0.11
    const fineChaos = Math.sin(elapsedSeconds * Math.PI * 12.8 + 0.8) * 0.06
    const irregularEnvelope = 0.82 + 0.18 * Math.sin(elapsedSeconds * Math.PI * 0.7)
    return clamp(0.54 + baselineDrift + (coarseChaos + fineChaos) * irregularEnvelope, 0.1, 0.88)
  }

  return clamp(0.56 + baselineDrift, 0.05, 0.93)
}

const getAcuteEcgSample = (
  rhythm: 'stemi_ant' | 'stemi_inf' | 'stemi_lat' | 'lbbb' | 'rbbb' | 'avblock3' | 'wpw',
  elapsedSeconds: number,
  rate: number,
): number => {
  const beatsPerSecond = clamp(rate / 60, 0.5, 3.4)
  const beatPosition = ((elapsedSeconds * beatsPerSecond % 1) + 1) % 1
  const baselineDrift = Math.sin(elapsedSeconds * Math.PI * 0.38) * 0.0025
  const morphology = getEcgMorphologyMod(elapsedSeconds, rate)
  const modBeatPosition = ((beatPosition + morphology.phase) % 1 + 1) % 1
  const amp = morphology.amplitude

  // â”€â”€ STEMI (sinus base with elevated ST + hyperacute T + pathological Q) â”€â”€
  if (rhythm === 'stemi_ant' || rhythm === 'stemi_inf' || rhythm === 'stemi_lat') {
    const pWave    = -0.050 * amp * gaussian(modBeatPosition, 0.185, 0.033)
    const prLift   = -0.003 * gaussian(modBeatPosition, 0.27,  0.026)
    const qWave    =  0.078 * amp * gaussian(modBeatPosition, 0.391, 0.010)  // pathological Q
    const rWave    = -0.48  * amp * gaussian(modBeatPosition, 0.404, 0.0052)
    const sWave    =  0.14  * amp * gaussian(modBeatPosition, 0.422, 0.010)
    const jPoint   = -0.035 * gaussian(modBeatPosition, 0.468, 0.024)
    const stPlateau = -0.052 * gaussian(modBeatPosition, 0.545, 0.072)
    const tWave    = -0.165 * (0.97 + amp * 0.03) * gaussian(modBeatPosition, 0.690, 0.078)
    const stElev = jPoint + stPlateau
    return clamp(0.565 + baselineDrift + pWave + prLift + qWave + rWave + sWave + stElev + tWave, 0.04, 0.94)
  }

  // â”€â”€ LBBB (wide notched QRS, no Q, discordant T) â”€â”€
  if (rhythm === 'lbbb') {
    const pWave   = -0.048 * amp * gaussian(modBeatPosition, 0.18,  0.030)
    const rHump1  = -0.205 * amp * gaussian(modBeatPosition, 0.392, 0.024)
    const notch   =  0.052 * gaussian(modBeatPosition, 0.423, 0.011)
    const rHump2  = -0.280 * amp * gaussian(modBeatPosition, 0.456, 0.024)
    const latSlur =  0.072 * gaussian(modBeatPosition, 0.508, 0.024)
    const tWave   =  0.092 * gaussian(modBeatPosition, 0.690, 0.086)
    return clamp(0.56 + baselineDrift + pWave + rHump1 + notch + rHump2 + latSlur + tWave, 0.04, 0.94)
  }

  // â”€â”€ RBBB (wide QRS with broad terminal S in II, RSR' in V1) â”€â”€
  if (rhythm === 'rbbb') {
    const pWave    = -0.050 * amp * gaussian(modBeatPosition, 0.185, 0.032)
    const qWave    =  0.022 * amp * gaussian(modBeatPosition, 0.393, 0.008)
    const rWave    = -0.390 * amp * gaussian(modBeatPosition, 0.405, 0.006)
    const sWave    =  0.055 * amp * gaussian(modBeatPosition, 0.429, 0.010)
    const rPrime   = -0.095 * amp * gaussian(modBeatPosition, 0.468, 0.019)
    const wideS    =  0.098 * amp * gaussian(modBeatPosition, 0.514, 0.028)
    const tWave    = -0.088 * gaussian(modBeatPosition, 0.715, 0.071)
    return clamp(0.565 + baselineDrift + pWave + qWave + rWave + sWave + rPrime + wideS + tWave, 0.04, 0.94)
  }

  // â”€â”€ AV block 3rd degree (slow wide escape QRS + independent P waves at ~75/min) â”€â”€
  if (rhythm === 'avblock3') {
    // Escape QRS uses beatPosition (rate â‰ˆ 35 bpm from RHYTHM_FIXED_HR)
    const escapeR  = -0.320 * gaussian(modBeatPosition, 0.420, 0.034)
    const escapeS  =  0.130 * gaussian(modBeatPosition, 0.510, 0.037)
    const escapeT  =  0.095 * gaussian(modBeatPosition, 0.668, 0.090)  // discordant
    // Independent P waves at fixed ~75/min — NOT synchronized to escape QRS
    const pBps     = 75 / 60
    const pPos     = ((elapsedSeconds * pBps + 0.28) % 1 + 1) % 1  // desynchronized offset
    const pWave    = -0.040 * gaussian(pPos, 0.50, 0.028)
    return clamp(0.56 + baselineDrift + escapeR + escapeS + escapeT + pWave, 0.04, 0.94)
  }

  // â”€â”€ WPW (delta wave = slurred pre-QRS, short PR, wide QRS) â”€â”€
  if (rhythm === 'wpw') {
    const pWave   = -0.048 * amp * gaussian(modBeatPosition, 0.176, 0.028)
    const delta   = -0.106 * amp * gaussian(modBeatPosition, 0.352, 0.024)  // slurred pre-excitation upstroke
    const rWave   = -0.430 * amp * gaussian(modBeatPosition, 0.401, 0.0065)
    const sWave   =  0.145 * amp * gaussian(modBeatPosition, 0.425, 0.013)
    const tWave   = -0.070 * gaussian(modBeatPosition, 0.676, 0.067)
    return clamp(0.565 + baselineDrift + pWave + delta + rWave + sWave + tWave, 0.04, 0.94)
  }

  return clamp(0.56 + baselineDrift, 0.05, 0.93)
}

const getLeadEcgSample = (
  rhythm: RhythmPreset,
  lead: EcgLead,
  elapsedSeconds: number,
  rate: number,
): number => {
  const base = getEcgSample(rhythm, elapsedSeconds, rate)
  if (rhythm === 'asystole' || rhythm === 'vfib') {
    return base
  }

  const baseSignal = clamp(0.56 - base, -0.48, 0.48)
  const meanAxis = RHYTHM_MEAN_AXIS[rhythm] + Math.sin(elapsedSeconds * Math.PI * 0.14) * 4
  const leadAxis = LEAD_AXIS_DEGREES[lead]
  const projection = Math.cos(((leadAxis - meanAxis) * Math.PI) / 180)

  // Per-rhythm precordial polarity overrides (LBBB/RBBB differ significantly from normal)
  const LBBB_PRECORDIAL: Record<string, number> = { V1: -0.88, V2: -0.72, V3: -0.38, V4: 0.22, V5: 0.72, V6: 0.88 }
  const RBBB_PRECORDIAL: Record<string, number> = { V1:  0.70, V2:  0.46, V3:  0.06, V4: 0.28, V5: 0.44, V6: 0.56 }
  const getPrecordialPolarity = (): number | null => {
    if (!(lead in PRECORDIAL_RS_PROGRESSION)) return null
    const l = lead as keyof typeof PRECORDIAL_RS_PROGRESSION
    if (rhythm === 'lbbb') return LBBB_PRECORDIAL[l] ?? PRECORDIAL_RS_PROGRESSION[l]
    if (rhythm === 'rbbb') return RBBB_PRECORDIAL[l] ?? PRECORDIAL_RS_PROGRESSION[l]
    return PRECORDIAL_RS_PROGRESSION[l]
  }
  const precordialPolarity = getPrecordialPolarity()

  const polarity = precordialPolarity ?? projection
  const amplitudeScale = precordialPolarity !== null
    ? 0.36 + Math.abs(precordialPolarity) * 0.92
    : 0.34 + Math.abs(projection) * 0.9

  const rhythmScale = rhythm === 'vtach' ? 1.1 : rhythm === 'pea' ? 0.82 : 1
  const fineNoise = Math.sin(elapsedSeconds * Math.PI * 12.7 + leadAxis * 0.01) * 0.0012
  const morphedSignal = baseSignal * polarity * amplitudeScale * rhythmScale
  let result = 0.56 - morphedSignal + fineNoise

  // STEMI territory: add lead-specific ST elevation / reciprocal depression
  if (rhythm === 'stemi_ant' || rhythm === 'stemi_inf' || rhythm === 'stemi_lat') {
    const bps = clamp(rate / 60, 0.5, 3.4)
    const bp  = ((elapsedSeconds * bps % 1) + 1) % 1
    const jPointComp = gaussian(bp, 0.468, 0.024) * 0.038
    const stPlateauComp = gaussian(bp, 0.545, 0.074) * 0.052
    const tComp  = gaussian(bp, 0.690, 0.078) * 0.056
    const elevMag = jPointComp + stPlateauComp + tComp

    let elevFactor = 0
    if (rhythm === 'stemi_ant') {
      if (lead === 'V1' || lead === 'V2' || lead === 'V3' || lead === 'V4') elevFactor =  1.00
      else if (lead === 'aVR')                                               elevFactor =  0.30
      else if (lead === 'V5' || lead === 'V6')                               elevFactor = -0.20
      else if (lead === 'I'  || lead === 'aVL')                              elevFactor = -0.15
    } else if (rhythm === 'stemi_inf') {
      if (lead === 'II' || lead === 'III' || lead === 'aVF')  elevFactor =  1.00
      else if (lead === 'I' || lead === 'aVL')                elevFactor = -0.50
      else if (lead === 'aVR')                                elevFactor = -0.15
    } else { // stemi_lat
      if (lead === 'I' || lead === 'aVL' || lead === 'V5' || lead === 'V6') elevFactor =  1.00
      else if (lead === 'V1' || lead === 'V2')                               elevFactor = -0.30
      else if (lead === 'III' || lead === 'aVF')                             elevFactor = -0.30
      else if (lead === 'V3' || lead === 'V4')                               elevFactor =  0.20
    }
    // Negative adjustment â†’ lower value â†’ upward on screen â†’ ST elevation
    result -= elevFactor * elevMag
  }

  return clamp(result, 0.06, 0.93)
}

const getPlethSample = (elapsedSeconds: number, rate: number): number => {
  const beatsPerSecond = clamp(rate / 60, 0.5, 3.4)
  const plethDelaySeconds = 0.14
  const beatPosition = ((((elapsedSeconds - plethDelaySeconds) * beatsPerSecond) % 1) + 1) % 1
  const pulseWidthScale = clamp(90 / Math.max(rate, 45), 0.9, 1.3)

  // Wrap gaussian lobes across cycle boundaries so the beat foot stays smooth at 0/1.
  const wrapGaussian = (center: number, width: number): number => (
    gaussian(beatPosition, center, width)
    + gaussian(beatPosition, center - 1, width)
    + gaussian(beatPosition, center + 1, width)
  )

  const systolicDome = -0.304 * wrapGaussian(0.29 * pulseWidthScale, 0.135 * pulseWidthScale)
  const shoulder = -0.116 * wrapGaussian(0.43 * pulseWidthScale, 0.125 * pulseWidthScale)
  const dicroticNotch = 0.01 * wrapGaussian(0.57 * pulseWidthScale, 0.072 * pulseWidthScale)
  const dicroticWave = -0.025 * wrapGaussian(0.67 * pulseWidthScale, 0.11 * pulseWidthScale)
  const diastolicTail = -0.011 * wrapGaussian(0.83 * pulseWidthScale, 0.19 * pulseWidthScale)
  const footLift = 0.003 * wrapGaussian(0.12 * pulseWidthScale, 0.07 * pulseWidthScale)

  const respiratoryMod = 0.95 + 0.05 * Math.sin(elapsedSeconds * Math.PI * 0.16)
  const baseline = 0.712 + Math.sin(elapsedSeconds * Math.PI * 0.2) * 0.0028
  const plethSignal =
    (systolicDome + shoulder + dicroticNotch + dicroticWave + diastolicTail + footLift)
    * respiratoryMod

  return clamp(baseline + plethSignal, 0.08, 0.92)
}

const getAbpSample = (elapsedSeconds: number, rate: number): number => {
  const beatsPerSecond = clamp(rate / 60, 0.5, 3.4)
  const abpDelaySeconds = 0.06
  const beatPosition = ((((elapsedSeconds - abpDelaySeconds) * beatsPerSecond) % 1) + 1) % 1
  const widthScale = clamp(90 / Math.max(rate, 45), 0.8, 1.2)
  const amplitudeScale = clamp(0.85 + (rate - 60) / 200, 0.85, 1.15)
  const upstrokeEnd = 0.155 * widthScale
  const peakAmplitude = -0.44 * amplitudeScale

  let primaryPulse = peakAmplitude
  if (beatPosition <= upstrokeEnd) {
    const x = clamp(beatPosition / upstrokeEnd, 0, 1)
    // Sharper systolic upstroke for more realism.
    primaryPulse = peakAmplitude * (1 - Math.cos(Math.PI * x)) * 0.52
  } else {
    const decayPhase = beatPosition - upstrokeEnd
    primaryPulse = peakAmplitude * Math.exp(-decayPhase / (0.22 * widthScale))
  }

  const earlyShoulder = -0.058 * amplitudeScale * gaussian(beatPosition, 0.23 * widthScale, 0.032 * widthScale)
  const systolicPlateau = -0.026 * amplitudeScale * gaussian(beatPosition, 0.295 * widthScale, 0.052 * widthScale)
  const incisura = 0.052 * amplitudeScale * gaussian(beatPosition, 0.36 * widthScale, 0.014 * widthScale)
  const dicroticWave = -0.068 * amplitudeScale * gaussian(beatPosition, 0.43 * widthScale, 0.035 * widthScale)
  const runoff = -0.02 * amplitudeScale * gaussian(beatPosition, 0.605 * widthScale, 0.108 * widthScale)
  const tail = -0.009 * amplitudeScale * gaussian(beatPosition, 0.79 * widthScale, 0.155 * widthScale)

  const baseline = 0.73 + Math.sin(elapsedSeconds * Math.PI * 0.12) * 0.0016
  const amplitudeMod = 0.96 + 0.04 * Math.sin(elapsedSeconds * Math.PI * 0.08)
  const abpSignal =
    (primaryPulse + earlyShoulder + systolicPlateau + incisura + dicroticWave + runoff + tail)
    * amplitudeMod

  return clamp(baseline + abpSignal, 0.07, 0.93)
}

const getEtco2Sample = (elapsedSeconds: number): number => {
  // Realistic capnography waveform (CO2)
  // Many breaths visible - plotting speed is controlled by sweep scaling
  // Classic three-phase morphology:
  // Phase 1: Rapid upstroke (dead space washout)
  // Phase 2: Alveolar plateau (with slight undulation)
  // Phase 3: Rapid downstroke to baseline (inspiration)
  
  const respiratoryRate = 3.2 // Hz - many breaths visible
  const breathCycle = (elapsedSeconds * respiratoryRate) % 1
  
  let co2Value = 0
  
  if (breathCycle < 0.08) {
    // Phase 1: Rapid exponential rise from zero
    const risePhase = breathCycle / 0.08
    co2Value = 0.32 * (1 - Math.exp(-8 * risePhase))
  } else if (breathCycle < 0.50) {
    // Phase 2: Alveolar plateau - relatively flat with micro-variations
    const plateauPhase = (breathCycle - 0.08) / 0.42
    // Nearly flat plateau with tiny ripples
    const peakValue = 0.32
    const microVary = 0.008 * Math.sin(plateauPhase * Math.PI * 3)
    co2Value = peakValue + microVary - 0.002 * plateauPhase
  } else if (breathCycle < 0.58) {
    // Phase 3: Sharp downstroke back to baseline
    const fallPhase = (breathCycle - 0.50) / 0.08
    co2Value = 0.33 * Math.exp(-12 * fallPhase)
  } else {
    // Baseline during inspiration
    co2Value = 0
  }
  
  const baselineWander = 0.003 * Math.sin(elapsedSeconds * Math.PI * 0.05)
  const co2Signal = co2Value + baselineWander
  
  return clamp(0.5 + co2Signal, 0.08, 0.92)
}

const getRespSample = (elapsedSeconds: number, respiratoryRate: number): number => {
  const breathsPerSecond = clamp(respiratoryRate / 60, 0.08, 0.7)
  const breathPosition = (((elapsedSeconds * breathsPerSecond) % 1) + 1) % 1

  // Asymmetric respiration: slower inspiratory rise and quicker expiratory decay.
  let phaseValue = 0
  if (breathPosition < 0.58) {
    const inspPhase = breathPosition / 0.58
    phaseValue = 0.5 * (1 - Math.cos(Math.PI * inspPhase))
  } else {
    const expPhase = (breathPosition - 0.58) / 0.42
    phaseValue = 0.5 * (1 + Math.cos(Math.PI * expPhase))
  }

  const tidalDepth = 0.94 + 0.06 * Math.sin(elapsedSeconds * Math.PI * 0.06)
  const cardiogenicOscillation = 0.006 * Math.sin(elapsedSeconds * Math.PI * 2.6)
  const baselineWander = 0.018 * Math.sin(elapsedSeconds * Math.PI * 0.08)
  const shoulder = 0.018 * Math.sin(Math.PI * 2 * breathPosition) * (1 - phaseValue)

  const respSignal = (phaseValue - 0.5) * 0.28 * tidalDepth + shoulder + cardiogenicOscillation + baselineWander
  return clamp(0.58 - respSignal, 0.12, 0.88)
}

type WaveClockSubscriber = (timestamp: number) => void
const waveClockSubscribers = new Set<WaveClockSubscriber>()
let waveClockFrameId: number | null = null

const runWaveClock = (timestamp: number) => {
  waveClockSubscribers.forEach((subscriber) => subscriber(timestamp))

  if (waveClockSubscribers.size === 0) {
    waveClockFrameId = null
    return
  }

  waveClockFrameId = window.requestAnimationFrame(runWaveClock)
}

const subscribeWaveClock = (subscriber: WaveClockSubscriber) => {
  waveClockSubscribers.add(subscriber)

  if (waveClockFrameId === null) {
    waveClockFrameId = window.requestAnimationFrame(runWaveClock)
  }

  return () => {
    waveClockSubscribers.delete(subscriber)

    if (waveClockSubscribers.size === 0 && waveClockFrameId !== null) {
      window.cancelAnimationFrame(waveClockFrameId)
      waveClockFrameId = null
    }
  }
}

const makeWavePoints = (rhythm: RhythmPreset, width = 620, height = 120): string => {
  const pattern = rhythmPatterns[rhythm]
  const step = width / 95
  const points: string[] = []

  for (let i = 0; i < 96; i += 1) {
    const ratio = i / 95
    const patternIndex = Math.floor((ratio * 16) % pattern.length)
    const y = pattern[patternIndex] * height
    points.push(`${(i * step).toFixed(2)},${y.toFixed(2)}`)
  }

  return points.join(' ')
}

const formatTemp = (value: number): string => value.toFixed(1)
const formatEtco2Kpa = (valueMmHg: number): string => (valueMmHg * MMHG_TO_KPA).toFixed(1)

const alarmLabel: Record<AlarmLevel, string> = {
  normal: 'Stabil',
  warning: 'Varning',
  critical: 'Kritisk',
}

interface WaveformProps {
  rhythm: RhythmPreset
  alarmLevel: AlarmLevel
  compact?: boolean
  variant?: 'ecg' | 'pleth' | 'abp' | 'etco2' | 'resp' | 'generic'
  rate?: number
  flatline?: boolean
  lead?: EcgLead
  visibleSecondsOverride?: number
}

const Waveform = ({ rhythm, alarmLevel, compact = false, variant = 'generic', rate = 80, flatline = false, lead, visibleSecondsOverride }: WaveformProps) => {
  const ecgPolylineRef = useRef<SVGPolylineElement | null>(null)
  const ecgCursorRef = useRef<SVGCircleElement | null>(null)
  const elapsedSecondsRef = useRef(0)
  const plottedPointsRef = useRef<string[]>([])
  const sweepProgressRef = useRef(0)
  const width = compact ? 340 : 620
  const height = compact ? 78 : 120

  useEffect(() => {
    const isSweepVariant = variant === 'ecg' || variant === 'pleth' || variant === 'abp' || variant === 'etco2' || variant === 'resp'

    if (!isSweepVariant) {
      return undefined
    }

    const visibleSeconds = visibleSecondsOverride ?? (compact ? 2.6 : 4.4)

    const polyline = ecgPolylineRef.current
    const cursor = ecgCursorRef.current

    if (!polyline || !cursor) {
      return undefined
    }

    const toSyncedElapsed = (rafTimestamp: number) => {
      const unixMs = window.performance.timeOrigin + rafTimestamp
      return (unixMs - WAVE_SYNC_EPOCH_MS) / 1000
    }

    const currentSyncedElapsed = () => (Date.now() - WAVE_SYNC_EPOCH_MS) / 1000

    const getSampleAt = (elapsed: number) => {
      if (flatline) {
        return 0.5
      }

      if (variant === 'pleth') {
        return getPlethSample(elapsed, rate)
      }

      if (variant === 'abp') {
        return getAbpSample(elapsed, rate)
      }

      if (variant === 'etco2') {
        return getEtco2Sample(elapsed)
      }

      if (variant === 'resp') {
        return getRespSample(elapsed, rate)
      }

      return lead ? getLeadEcgSample(rhythm, lead, elapsed, rate) : getEcgSample(rhythm, elapsed, rate)
    }

    const appendSegment = (startElapsed: number, endElapsed: number, startProgress: number, endProgress: number) => {
      if (endProgress <= startProgress) {
        return
      }

      const startX = startProgress * width
      const endX = endProgress * width
      const span = Math.max(endX - startX, 0)
      const steps = Math.max(1, Math.ceil(span / 2))

      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps
        const sampleElapsed = startElapsed + (endElapsed - startElapsed) * ratio
        const sampleProgress = startProgress + (endProgress - startProgress) * ratio
        const x = sampleProgress * width
        const y = getSampleAt(sampleElapsed) * height
        plottedPointsRef.current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
      }
    }

    const rebuildTraceToProgress = (elapsed: number, progress: number) => {
      plottedPointsRef.current = []
      if (progress <= 0) {
        return
      }

      const sweepStartElapsed = elapsed - progress * visibleSeconds
      appendSegment(sweepStartElapsed, elapsed, 0, progress)
    }

    const initialElapsed = currentSyncedElapsed()
    const co2TimeScale = variant === 'etco2' ? 0.25 : 0.5
    const initialScaledElapsed = initialElapsed * co2TimeScale
    const initialProgress = ((initialScaledElapsed % visibleSeconds) + visibleSeconds) % visibleSeconds / visibleSeconds
    elapsedSecondsRef.current = initialElapsed
    sweepProgressRef.current = initialProgress
    rebuildTraceToProgress(initialScaledElapsed, initialProgress)
    polyline.setAttribute('points', plottedPointsRef.current.join(' '))

    const initialY = getSampleAt(initialElapsed) * height
    cursor.setAttribute('cx', (initialProgress * width).toFixed(2))
    cursor.setAttribute('cy', initialY.toFixed(2))

    const animate = (timestamp: number) => {
      const previousElapsed = elapsedSecondsRef.current
      const nextElapsed = toSyncedElapsed(timestamp)
      const co2TimeScale = variant === 'etco2' ? 0.25 : 0.5
      const previousScaledElapsed = previousElapsed * co2TimeScale
      const nextScaledElapsed = nextElapsed * co2TimeScale
      elapsedSecondsRef.current = nextElapsed

      const previousSweepProgress = sweepProgressRef.current
      const currentSweepProgress = ((nextScaledElapsed % visibleSeconds) + visibleSeconds) % visibleSeconds / visibleSeconds

      if (currentSweepProgress < previousSweepProgress) {
        const sweepEndElapsed = previousScaledElapsed + (1 - previousSweepProgress) * visibleSeconds
        appendSegment(previousScaledElapsed, sweepEndElapsed, previousSweepProgress, 1)
        polyline.setAttribute('points', plottedPointsRef.current.join(' '))

        plottedPointsRef.current = []
        appendSegment(sweepEndElapsed, nextScaledElapsed, 0, currentSweepProgress)
      } else {
        appendSegment(previousScaledElapsed, nextScaledElapsed, previousSweepProgress, currentSweepProgress)
      }

      sweepProgressRef.current = currentSweepProgress
      polyline.setAttribute('points', plottedPointsRef.current.join(' '))

      const cursorX = currentSweepProgress * width
      const cursorY = getSampleAt(nextElapsed) * height
      cursor.setAttribute('cx', cursorX.toFixed(2))
      cursor.setAttribute('cy', cursorY.toFixed(2))
    }

    const unsubscribe = subscribeWaveClock(animate)

    return () => unsubscribe()
  }, [compact, flatline, height, rate, rhythm, variant, width, lead, visibleSecondsOverride])

  const points = useMemo(() => makeWavePoints(rhythm, width, height), [height, rhythm, width])
  const isSweepVariant = variant === 'ecg' || variant === 'pleth' || variant === 'abp' || variant === 'etco2' || variant === 'resp'

  return (
    <div className={`wave ${alarmLevel} ${compact ? 'compact' : ''}`}>
      <svg
        viewBox={compact ? '0 0 340 78' : '0 0 620 120'}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {isSweepVariant ? (
          <>
            <polyline ref={ecgPolylineRef} points="" />
            <circle ref={ecgCursorRef} cx="0" cy={String(height / 2)} r={compact ? 1.8 : 2.4} />
          </>
        ) : (
          <polyline points={points} />
        )}
      </svg>
    </div>
  )
}

interface VitalTileProps {
  label: string
  value: string
  unit: string
  tone?: 'green' | 'blue' | 'yellow' | 'white'
  inactive?: boolean
}

const VitalTile = ({ label, value, unit, tone = 'green', inactive = false }: VitalTileProps) => (
  <article className={`vital-tile ${tone} ${inactive ? 'inactive' : ''}`}>
    <p className="vital-label">{label}</p>
    <p className="vital-value">{value}</p>
    <p className="vital-unit">{unit}</p>
  </article>
)

const AlarmLimits = ({ low, high }: { low: number; high: number }) => (
  <div className="intel-limits" aria-hidden="true">
    <span>{high}</span>
    <span>{low}</span>
  </div>
)

interface IntellivueMetricProps {
  label: string
  value: string | number
  low: number
  high: number
  tone: 'green' | 'blue' | 'red' | 'white'
  alarmState?: AlarmLevel
  inactive?: boolean
  secondary?: string
  onClick?: () => void
  selected?: boolean
}

const IntellivueMetric = ({
  label,
  value,
  low,
  high,
  tone,
  alarmState = 'normal',
  inactive = false,
  secondary = '',
  onClick,
  selected = false,
}: IntellivueMetricProps) => (
  <button
    type="button"
    className={`intel-metric ${tone} ${alarmState !== 'normal' ? alarmState : ''} ${inactive ? 'inactive' : ''} ${onClick ? 'clickable' : ''} ${selected ? 'selected' : ''}`}
    onClick={onClick}
    aria-pressed={selected}
    disabled={!onClick}
  >
    <div className="intel-metric-body">
      <div className="intel-metric-side">
        <p>{label}</p>
        <AlarmLimits low={low} high={high} />
      </div>
      <div className="intel-metric-values">
        <strong>{value}</strong>
        <small>{secondary}</small>
      </div>
    </div>
  </button>
)

interface InstructorProps {
  state: SimulationState
  updateVitals: (patch: Partial<Vitals>) => void
  setRhythm: (rhythm: RhythmPreset) => void
  setParameterVisibility: (parameter: MonitorParamKey, isVisible: boolean) => void
  triggerNibpReading: () => void
  addMedia: (item: { title: string; type: MediaType; url: string }) => string
  removeMedia: (id: string) => void
  setActiveMedia: (id: string) => void
  setActiveMediaForChannel: (channel: MediaChannel, id: string | null) => void
  triggerMajorBleeding: () => void
  triggerMtp: () => void
  giveCalcium: () => void
  resetBloodGasGenerator: () => void
  setBloodGasSampleType: (sampleType: BloodGasSampleType) => void
  addSound: (item: { title: string; url: string }) => void
  removeSound: (id: string) => void
  setActiveSound: (id: string) => void
  setVentilated: (ventilated: boolean) => void
}

const InstructorScreen = ({
  state,
  updateVitals,
  setRhythm,
  setParameterVisibility,
  triggerNibpReading,
  addMedia,
  removeMedia,
  setActiveMedia,
  setActiveMediaForChannel,
  triggerMajorBleeding,
  triggerMtp,
  giveCalcium,
  resetBloodGasGenerator,
  setBloodGasSampleType,
  addSound,
  removeSound,
  setActiveSound,
  setVentilated,
}: InstructorProps) => {
  const bpSliderMin = 20
  const bpSliderMax = 240
  const [mediaTitle, setMediaTitle] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('image')
  const [mediaUploadError, setMediaUploadError] = useState('')
  const [selectedXrayOption, setSelectedXrayOption] = useState('')
  const [selectedUltrasoundMediaId, setSelectedUltrasoundMediaId] = useState('')
  const [selectedLabMediaId, setSelectedLabMediaId] = useState('')
  const [soundTitle, setSoundTitle] = useState('')
  const [soundUrl, setSoundUrl] = useState('')
  const [soundUploadError, setSoundUploadError] = useState('')

  const xrayPresetTitles = new Set([
    XRAY_SUBDURAL_PRESET.title.trim().toLowerCase(),
    XRAY_RADIUS_ULNA_PRESET.title.trim().toLowerCase(),
  ])
  const xrayLibraryItems = state.mediaLibrary.filter(
    (item) => !xrayPresetTitles.has(item.title.trim().toLowerCase()),
  )
  const nonXrayLibraryItems = xrayLibraryItems

  const resetSelectionForSource = (source: MediaChannel | null, mediaId?: string) => {
    if (source === 'xray') {
      setSelectedXrayOption('')
      return
    }
    if (source === 'ultrasound') {
      setSelectedUltrasoundMediaId('')
      return
    }
    if (source === 'lab') {
      setSelectedLabMediaId('')
      return
    }
    if (mediaId) {
      if (selectedXrayOption === mediaId) setSelectedXrayOption('')
      if (selectedUltrasoundMediaId === mediaId) setSelectedUltrasoundMediaId('')
      if (selectedLabMediaId === mediaId) setSelectedLabMediaId('')
    }
  }

  const showSingleMedia = (id: string, source: MediaChannel | null) => {
    setActiveMedia(id)
    if (source) {
      setActiveMediaForChannel(source, id)
    }
  }

  const activateXrayPreset = (preset: { title: string; type: MediaType; url: string }) => {
    const existing = state.mediaLibrary.find((item) => item.title.toLowerCase() === preset.title.toLowerCase())
    if (existing) {
      showSingleMedia(existing.id, 'xray')
      return
    }

    const mediaId = addMedia(preset)
    showSingleMedia(mediaId, 'xray')
  }

  const onSubmitMedia = (event: FormEvent) => {
    event.preventDefault()
    const title = mediaTitle.trim()
    const url = mediaUrl.trim()
    if (!title || !url) {
      return
    }
    const mediaId = addMedia({ title, type: mediaType, url })
    showSingleMedia(mediaId, null)
    setMediaTitle('')
    setMediaUrl('')
    setMediaUploadError('')
  }

  const onPickLocalMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const url = await readFileAsDataUrl(file)
      const inferredType: MediaType = file.type.startsWith('video/') ? 'video' : 'image'
      const normalizedTitle = file.name.replace(/\.[^.]+$/, '').trim() || 'Lokalt media'
      const mediaId = addMedia({
        title: normalizedTitle,
        type: inferredType,
        url,
      })
      showSingleMedia(mediaId, null)
      setMediaUploadError('')
      setMediaTitle('')
      setMediaUrl('')
      setMediaType(inferredType)
    } catch {
      setMediaUploadError('Kunde inte lasa filen. Forsok igen med en annan fil.')
    } finally {
      // Allow selecting the same file again.
      event.target.value = ''
    }
  }

  const onSubmitSound = (event: FormEvent) => {
    event.preventDefault()
    const title = soundTitle.trim()
    const url = soundUrl.trim()
    if (!title || !url) {
      return
    }
    addSound({ title, url })
    setSoundTitle('')
    setSoundUrl('')
    setSoundUploadError('')
  }

  const onPickLocalSound = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const url = await readFileAsDataUrl(file)
      const normalizedTitle = file.name.replace(/\.[^.]+$/, '').trim() || 'Lokalt ljud'
      const title = soundTitle.trim() || normalizedTitle
      addSound({ title, url })
      setSoundTitle('')
      setSoundUrl('')
      setSoundUploadError('')
    } catch {
      setSoundUploadError('Kunde inte lasa ljudfilen. Forsok igen med en annan fil.')
    } finally {
      // Allow selecting the same file again.
      event.target.value = ''
    }
  }

  const handleRemoveMedia = (id: string) => {
    removeMedia(id)
    resetSelectionForSource(null, id)
  }

  const maxNibpDia = Math.max(bpSliderMin, state.vitals.nibpSys - 10)

  const applyAcuteScenario = (rhythm: RhythmPreset) => {
    setRhythm(rhythm)
    if (rhythm === 'stemi_ant' || rhythm === 'stemi_lat') {
      updateVitals({ hr: 94, nibpSys: 118, nibpDia: 74 })
    } else if (rhythm === 'stemi_inf') {
      updateVitals({ hr: 58, nibpSys: 108, nibpDia: 68 })  // vagal bradycardia common
    } else if (rhythm === 'avblock3') {
      updateVitals({ nibpSys: 92, nibpDia: 56 })           // HR set by RHYTHM_FIXED_HR=35
    }
    // lbbb, rbbb, wpw: keep current vitals
  }

  return (
    <section className="instructor-screen screen-shell">
      <header className="screen-header">
        <h2>Instruktörpanel</h2>
      </header>

      <div className="instructor-grid">
        <div className="control-card">
          <h3>Vitalparametrar</h3>
          <div className="slider-grid">
            <label>
              <span className="label-row">
                <span>AF</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.rr}
                    onChange={(event) => setParameterVisibility('rr', event.target.checked)}
                  />
                  Visa
                </span>
                <span className="param-toggle ventilated-toggle">
                  <input
                    type="checkbox"
                    checked={state.ventilated}
                    onChange={(event) => setVentilated(event.target.checked)}
                  />
                  Ventileras
                </span>
              </span>
              {state.ventilated ? (
                <div className="vent-locked-rr">
                  <span className="vent-rr-value">{state.ventilatorSettings.rr} /min · VT {state.ventilatorSettings.vt} ml ({(state.ventilatorSettings.vt / (state.ventilatorSettings.weight ?? 70)).toFixed(1)} ml/kg)</span>
                  <span className="vent-info">FiO₂ {state.ventilatorSettings.fio2}% · PEEP {state.ventilatorSettings.peep} cmH₂O</span>
                </div>
              ) : (
                <>
                  <input
                    type="range"
                    min={0}
                    max={45}
                    value={state.vitals.rr}
                    onChange={(event) => updateVitals({ rr: clamp(Number(event.target.value), 0, 45) })}
                  />
                  <span>{state.vitals.rr} /min</span>
                </>
              )}
            </label>
            <label>
              <span className="label-row">
                <span>SpO2</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.spo2}
                    onChange={(event) => setParameterVisibility('spo2', event.target.checked)}
                  />
                  Visa
                </span>
              </span>
              <input
                type="range"
                min={50}
                max={100}
                value={state.vitals.spo2}
                onChange={(event) => updateVitals({ spo2: clamp(Number(event.target.value), 50, 100) })}
              />
              <span>{state.vitals.spo2} %</span>
            </label>
            <label>
              <span className="label-row">
                <span>EtCO2</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.etco2}
                    onChange={(event) => setParameterVisibility('etco2', event.target.checked)}
                  />
                  Visa
                </span>
              </span>
              <input
                type="range"
                min={5}
                max={80}
                value={state.vitals.etco2}
                onChange={(event) => updateVitals({ etco2: clamp(Number(event.target.value), 5, 80) })}
              />
              <span>{formatEtco2Kpa(state.vitals.etco2)} kPa</span>
            </label>
            <label>
              <span className="label-row">
                <span>Puls</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.hr}
                    onChange={(event) => setParameterVisibility('hr', event.target.checked)}
                  />
                  Visa
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={220}
                value={state.vitals.hr}
                onChange={(event) => updateVitals({ hr: clamp(Number(event.target.value), 0, 220) })}
              />
              <span>{state.vitals.hr} bpm</span>
            </label>
            <label>
              <span className="label-row">
                <span>Systoliskt BT</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.abp}
                    onChange={(event) => setParameterVisibility('abp', event.target.checked)}
                  />
                  Visa ABP
                </span>
              </span>
              <input
                type="range"
                min={bpSliderMin}
                max={bpSliderMax}
                value={state.vitals.nibpSys}
                onChange={(event) =>
                  updateVitals({ nibpSys: clamp(Number(event.target.value), bpSliderMin, bpSliderMax) })
                }
              />
              <span>{state.vitals.nibpSys} mmHg</span>
            </label>
            <label>
              Diastoliskt BT
              <input
                type="range"
                min={bpSliderMin}
                max={bpSliderMax}
                value={state.vitals.nibpDia}
                onChange={(event) =>
                  updateVitals({ nibpDia: clamp(Number(event.target.value), bpSliderMin, maxNibpDia) })
                }
              />
              <span>{state.vitals.nibpDia} mmHg</span>
            </label>
            <div className="nibp-trigger-row">
              <button type="button" className="chip-button" onClick={triggerNibpReading}>
                Ta NIBP ({state.vitals.nibpSys}/{state.vitals.nibpDia})
              </button>
            </div>
            <label>
              <span className="label-row">
                <span>Temperatur</span>
                <span className="param-toggle">
                  <input
                    type="checkbox"
                    checked={state.parameterVisibility.temp}
                    onChange={(event) => setParameterVisibility('temp', event.target.checked)}
                  />
                  Visa
                </span>
              </span>
              <input
                type="range"
                min={30}
                max={42}
                step={0.1}
                value={state.vitals.temp}
                onChange={(event) => updateVitals({ temp: clamp(Number(event.target.value), 30, 42) })}
              />
              <span>{formatTemp(state.vitals.temp)} C</span>
            </label>
          </div>
        </div>

        <div className="instructor-side-stack">
          <div className="control-card compact-card">
            <h3>Rytm</h3>
            <div className="button-group">
              {RHYTHM_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`state-button ${state.rhythm === option ? 'active' : ''}`}
                  onClick={() => setRhythm(option)}
                >
                  {RHYTHM_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="control-card compact-card">
            <h3>Akuta EKG-tillstånd</h3>
            <div className="button-group">
              {ACUTE_RHYTHM_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`state-button acute-ecg-btn ${state.rhythm === option ? 'active' : ''}`}
                  title={ACUTE_RHYTHM_DESC[option] ?? ''}
                  onClick={() => applyAcuteScenario(option)}
                >
                  {RHYTHM_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="control-card sound-control">
            <h3>Spela upp ljud</h3>
            <form onSubmit={onSubmitSound} className="sound-form">
              <input
                value={soundTitle}
                placeholder="Titel"
                onChange={(event) => setSoundTitle(event.target.value)}
              />
              <input
                value={soundUrl}
                placeholder="URL till dockljud"
                onChange={(event) => setSoundUrl(event.target.value)}
              />
              <button type="submit" className="primary-button">
                Lagg till ljud
              </button>
            </form>
            <label className="media-upload-inline" htmlFor="local-sound-upload">
              Ladda upp ljudfil (audio)
            </label>
            <input
              id="local-sound-upload"
              type="file"
              accept="audio/*"
              className="media-upload-input"
              onChange={onPickLocalSound}
            />
            {soundUploadError ? <p className="media-upload-error">{soundUploadError}</p> : null}

            <div className="sound-list">
              {state.soundLibrary.length === 0 ? <p>Inga ljud tillagda.</p> : null}
              {state.soundLibrary.map((item) => (
                <div key={item.id} className={`sound-row ${state.activeSoundId === item.id ? 'active' : ''}`}>
                  <div>
                    <strong>{item.title}</strong>
                  </div>
                  <div className="sound-actions">
                    <button type="button" onClick={() => setActiveSound(item.id)}>
                      Spela
                    </button>
                    <button type="button" onClick={() => removeSound(item.id)}>
                      Ta bort
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="sound-note">Larmljud hanteras av respektive monitorfonster.</p>
          </div>

          <div className="control-card bloodgas-generator-card">
            <h3>Blodgasgenerator</h3>
            <p className="bloodgas-generator-note">
              Generatorn anpassas efter patientens status samt valda händelser.
            </p>
            <div className="bloodgas-sample-row">
              <label htmlFor="bloodgas-sample-type">Provtyp</label>
              <select
                id="bloodgas-sample-type"
                value={state.bloodGasSampleType}
                onChange={(event) => setBloodGasSampleType(event.target.value as BloodGasSampleType)}
              >
                <option value="arterial">Arteriell</option>
                <option value="venous">Venös</option>
              </select>
            </div>
            <div className="bloodgas-actions">
              <button type="button" className="state-button" onClick={triggerMajorBleeding}>Stor blödning</button>
              <button type="button" className="state-button" onClick={triggerMtp}>MTP</button>
              <button type="button" className="state-button" onClick={giveCalcium}>Kalcium</button>
              <button type="button" className="ghost" onClick={resetBloodGasGenerator}>Återställ</button>
            </div>
            <div className="bloodgas-status-row">
              <span>Blödning nivå: {state.bloodGasControl.majorBleedLevel}</span>
              <span>MTP: {state.bloodGasControl.mtpCycles}</span>
              <span>Kalcium: {state.bloodGasControl.calciumDoses}</span>
            </div>
            <BloodGasValuesGrid values={state.bloodGas} sampleType={state.bloodGasSampleType} compact />
          </div>
        </div>

        <div className="control-card media-control">
          <h3>Media till projektion</h3>

          <div className="projection-select-grid">
            <label className="media-picker-label" htmlFor="xray-media-picker">Röntgen</label>
            <select
              id="xray-media-picker"
              value={selectedXrayOption}
              onChange={(event) => {
                const value = event.target.value
                setSelectedXrayOption(value)
                setSelectedUltrasoundMediaId('')
                setSelectedLabMediaId('')
                if (value === XRAY_SUBDURAL_PRESET_VALUE) {
                  activateXrayPreset(XRAY_SUBDURAL_PRESET)
                } else if (value === XRAY_RADIUS_ULNA_PRESET_VALUE) {
                  activateXrayPreset(XRAY_RADIUS_ULNA_PRESET)
                } else if (value) {
                  showSingleMedia(value, 'xray')
                } else {
                  setActiveMediaForChannel('xray', null)
                }
              }}
            >
              <option value="">Valj rontgen</option>
              <option value={XRAY_SUBDURAL_PRESET_VALUE}>Akut subdural hematom</option>
              <option value={XRAY_RADIUS_ULNA_PRESET_VALUE}>Radius och Ulna fraktur</option>
              {xrayLibraryItems.map((item) => (
                <option key={`xray-${item.id}`} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>

            <label className="media-picker-label" htmlFor="ultrasound-media-picker">Ultraljud</label>
            <select
              id="ultrasound-media-picker"
              value={selectedUltrasoundMediaId}
              onChange={(event) => {
                const value = event.target.value
                setSelectedUltrasoundMediaId(value)
                setSelectedXrayOption('')
                setSelectedLabMediaId('')
                if (value) {
                  showSingleMedia(value, 'ultrasound')
                } else {
                  setActiveMediaForChannel('ultrasound', null)
                }
              }}
            >
              <option value="">Valj ultraljud</option>
              {nonXrayLibraryItems.map((item) => (
                <option key={`us-${item.id}`} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>

            <label className="media-picker-label" htmlFor="lab-media-picker">Provsvar och blodgas</label>
            <select
              id="lab-media-picker"
              value={selectedLabMediaId}
              onChange={(event) => {
                const value = event.target.value
                setSelectedLabMediaId(value)
                setSelectedXrayOption('')
                setSelectedUltrasoundMediaId('')
                if (value) {
                  showSingleMedia(value, 'lab')
                } else {
                  setActiveMediaForChannel('lab', null)
                }
              }}
            >
              <option value="">Valj provsvar och blodgas</option>
              {nonXrayLibraryItems.map((item) => (
                <option key={`lab-${item.id}`} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={onSubmitMedia} className="media-form">
            <input
              value={mediaTitle}
              placeholder="Titel"
              onChange={(event) => setMediaTitle(event.target.value)}
            />
            <input
              value={mediaUrl}
              placeholder="URL till bild eller video"
              onChange={(event) => setMediaUrl(event.target.value)}
            />
            <select value={mediaType} onChange={(event) => setMediaType(event.target.value as MediaType)}>
              <option value="image">Bild</option>
              <option value="video">Video</option>
            </select>
            <button type="submit" className="primary-button">
              Lagg till och visa
            </button>
          </form>

          <label className="media-picker-label" htmlFor="local-media-file">Eller valj fil fran datorn</label>
          <input
            id="local-media-file"
            className="media-file-input"
            type="file"
            accept="image/*,video/*"
            onChange={onPickLocalMedia}
          />
          {mediaUploadError ? <p className="media-upload-error">{mediaUploadError}</p> : null}

          <div className="media-list">
            {state.mediaLibrary.length === 0 ? <p>Inga media tillagda.</p> : null}
            {state.mediaLibrary.map((item) => (
              <div key={item.id} className={`media-row ${state.activeMediaId === item.id ? 'active' : ''}`}>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.type === 'image' ? 'Bild' : 'Video'}</p>
                </div>
                <div className="media-actions">
                  <button
                    type="button"
                    onClick={() => {
                      showSingleMedia(item.id, null)
                    }}
                  >
                    {state.activeMediaId === item.id ? 'Visas nu' : 'Visa'}
                  </button>
                  <button type="button" onClick={() => handleRemoveMedia(item.id)}>
                    Ta bort
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

interface MonitorProps {
  state: SimulationState
  title: string
  compact?: boolean
  flavor: 'intellivue' | 'corpuls3' | 'x2' | 'x3'
  triggerNibpReading?: () => void
}

const EKG_LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V4', 'V5'] as const
type EkgLead = typeof EKG_LEADS[number]

type VitalsTrendEntry = { time: Date; hr: number; spo2: number; sys: number; dia: number; rr: number; temp: number }
type AlarmLimitTarget = 'hr' | 'spo2' | 'abp' | 'etco2' | 'rr'

const IntellivueScreen = ({
  state,
  triggerNibpReading,
}: {
  state: SimulationState
  triggerNibpReading?: () => void
}) => {
  const [now, setNow] = useState(() => new Date())
  const [alarmsPausedUntil, setAlarmsPausedUntil] = useState<number | null>(null)
  const [acknowledgedAlarms, setAcknowledgedAlarms] = useState<AcknowledgedAlarm[]>([])
  const [nbpAutoInterval, setNbpAutoInterval] = useState<number>(0) // minutes; 0 = manual
  const [nbpAutoRemaining, setNbpAutoRemaining] = useState<number>(0)
  const [patientCategory, setPatientCategory] = useState<'Vuxen' | 'Barn' | 'Neonatal'>('Vuxen')
  const [showAlarmReview, setShowAlarmReview] = useState(false)
  const [showPatientSetup, setShowPatientSetup] = useState(false)
  const [showVitalsTrend, setShowVitalsTrend] = useState(false)
  const [showAlarmLimits, setShowAlarmLimits] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [standby, setStandby] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [frozenAt, setFrozenAt] = useState<Date | null>(null)
  const [ekgLead, setEkgLead] = useState<EkgLead>('II')
  const [showEkgLeadSelector, setShowEkgLeadSelector] = useState(false)
  const [ekgPopupPos, setEkgPopupPos] = useState<{ top: number; left: number } | null>(null)
  const ekgButtonRef = useRef<HTMLButtonElement | null>(null)
  const [ekgFilter, setEkgFilter] = useState<'Monitor' | 'Diagnostik' | 'Kirurgi'>('Monitor')
  const [waveSpeed, setWaveSpeed] = useState<12.5 | 25 | 50>(25)
  const [qrsTone, setQrsTone] = useState(true)
  // Local alarm limits (editable)
  const [hrLow, setHrLow] = useState<number>(ALARM_LIMITS.hr.low)
  const [hrHigh, setHrHigh] = useState<number>(ALARM_LIMITS.hr.high)
  const [spo2Low, setSpo2Low] = useState<number>(ALARM_LIMITS.spo2.low)
  const [abpLow, setAbpLow] = useState<number>(ALARM_LIMITS.abpSys.low)
  const [abpHigh, setAbpHigh] = useState<number>(ALARM_LIMITS.abpSys.high)
  const [etco2Low, setEtco2Low] = useState<number>(ALARM_LIMITS.etco2.low)
  const [etco2High, setEtco2High] = useState<number>(ALARM_LIMITS.etco2.high)
  const [rrLow, setRrLow] = useState<number>(8)
  const [rrHigh, setRrHigh] = useState<number>(30)
  const [alarmLimitTarget, setAlarmLimitTarget] = useState<AlarmLimitTarget>('hr')
  const [alarmHistory, setAlarmHistory] = useState<Array<{ id: string; text: string; level: 'red' | 'yellow'; time: Date }>>([])
  const [alarmVolume, setAlarmVolume] = useState<number>(5)
  const [alarmDisplayIndex, setAlarmDisplayIndex] = useState(0)
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingAlarmPlayRef = useRef(false)
  const prevAlarmIdsRef = useRef<Set<string>>(new Set())
  const vitalsTrendRef = useRef<VitalsTrendEntry[]>([])
  const [vitalsTrendSnapshot, setVitalsTrendSnapshot] = useState<VitalsTrendEntry[]>([])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Vitals trend: sample every 60 s (keep 15 entries)
  useEffect(() => {
    const id = setInterval(() => {
      const entry: VitalsTrendEntry = {
        time: new Date(),
        hr: state.vitals.hr,
        spo2: state.vitals.spo2,
        sys: state.vitals.nibpSys,
        dia: state.vitals.nibpDia,
        rr: state.vitals.rr,
        temp: state.vitals.temp,
      }
      vitalsTrendRef.current = [entry, ...vitalsTrendRef.current].slice(0, 15)
      if (showVitalsTrend) setVitalsTrendSnapshot([...vitalsTrendRef.current])
    }, 60000)
    return () => clearInterval(id)
  }, [state.vitals, showVitalsTrend])

  // Sync snapshot when overlay opens
  useEffect(() => {
    if (showVitalsTrend) setVitalsTrendSnapshot([...vitalsTrendRef.current])
  }, [showVitalsTrend])

  const dateStr = now.toLocaleDateString('sv-SE', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  const { parameterVisibility } = state
  const hideSpo2Value = state.vitals.nibpSys < 60
  const hideEtco2Value = state.vitals.nibpSys < 40
  const hideAbpWave = state.rhythm === 'asystole' || state.rhythm === 'pea'
  const showSpo2 = parameterVisibility.spo2 && !hideSpo2Value
  const showEtco2 = parameterVisibility.etco2 && !hideEtco2Value
  const showAbpWave = parameterVisibility.abp && !hideAbpWave
  const showRr = parameterVisibility.rr
  const showTemp = parameterVisibility.temp
  const alarmsPaused = alarmsPausedUntil !== null && now.getTime() < alarmsPausedUntil

  // NBP auto-interval: reset countdown when interval changes
  useEffect(() => {
    if (nbpAutoInterval === 0) { setNbpAutoRemaining(0); return }
    setNbpAutoRemaining(nbpAutoInterval * 60)
  }, [nbpAutoInterval])

  // NBP auto-interval: tick countdown and trigger
  useEffect(() => {
    if (nbpAutoInterval === 0) return
    if (nbpAutoRemaining <= 0) {
      triggerNibpReading?.()
      setNbpAutoRemaining(nbpAutoInterval * 60)
      return
    }
    const timer = window.setTimeout(() => setNbpAutoRemaining(r => r - 1), 1000)
    return () => clearTimeout(timer)
  }, [nbpAutoRemaining, nbpAutoInterval, triggerNibpReading])

  // Compute active alarms from vitals/rhythm
  type AlarmEntry = { id: string; text: string; level: 'red' | 'yellow' }
  const rawAlarms = useMemo<AlarmEntry[]>(() => {
    const list: AlarmEntry[] = []
    if (state.rhythm === 'vfib') list.push({ id: 'vfib', text: 'Kammarflimmer', level: 'red' })
    else if (state.rhythm === 'vtach') list.push({ id: 'vtach', text: 'Kammarrytm', level: 'red' })
    else if (state.rhythm === 'asystole') list.push({ id: 'asystole', text: 'Asystoli', level: 'red' })
    else if (state.rhythm === 'afib') list.push({ id: 'afib', text: 'Förmaksflimmer', level: 'yellow' })
    if (parameterVisibility.hr) {
      if (state.vitals.hr > hrHigh) list.push({ id: 'hr-high', text: `HF hög ${state.vitals.hr}>${hrHigh}`, level: 'yellow' })
      if (state.vitals.hr < hrLow) list.push({ id: 'hr-low', text: `HF låg ${state.vitals.hr}<${hrLow}`, level: 'yellow' })
    }
    if (parameterVisibility.spo2 && state.vitals.spo2 <= spo2Low) {
      list.push({ id: 'spo2-low', text: `Desat SpO2 ${state.vitals.spo2}%<=${spo2Low}`, level: 'red' })
    }
    if (parameterVisibility.abp && state.vitals.nibpSys < abpLow) {
      list.push({ id: 'abp-low', text: `ABP låg ${state.vitals.nibpSys}/${state.vitals.nibpDia}`, level: 'red' })
    }
    if (parameterVisibility.abp && state.vitals.nibpSys > abpHigh) {
      list.push({ id: 'abp-high', text: `ABP hög ${state.vitals.nibpSys}>${abpHigh}`, level: 'yellow' })
    }
    if (showEtco2 && state.vitals.etco2 < etco2Low) {
      list.push({ id: 'etco2-low', text: `etCO2 låg`, level: 'yellow' })
    }
    if (showEtco2 && state.vitals.etco2 > etco2High) {
      list.push({ id: 'etco2-high', text: `etCO2 hög`, level: 'yellow' })
    }
    if (showRr && state.vitals.rr < rrLow) {
      list.push({ id: 'rr-low', text: `RF låg ${state.vitals.rr}<${rrLow}`, level: 'yellow' })
    }
    if (showRr && state.vitals.rr > rrHigh) {
      list.push({ id: 'rr-high', text: `RF hög ${state.vitals.rr}>${rrHigh}`, level: 'yellow' })
    }
    return list
  }, [state.rhythm, state.vitals.hr, state.vitals.spo2, state.vitals.nibpSys, state.vitals.nibpDia, state.vitals.etco2, state.vitals.rr, parameterVisibility.hr, parameterVisibility.spo2, parameterVisibility.abp, showEtco2, showRr, hrLow, hrHigh, spo2Low, abpLow, abpHigh, etco2Low, etco2High, rrLow, rrHigh])

  useEffect(() => {
    const nowMs = now.getTime()
    // Auto-expire acknowledged alarms after 2 minutes (120000 ms) or if value worsens
    setAcknowledgedAlarms((prev) => {
      return prev.filter((ack) => {
        // Check if 2 minutes have passed
        if (nowMs - ack.acknowledgedAt >= 120000) {
          return false
        }
        // If condition clears, remove ack so a future re-breach triggers again.
        const stillExists = rawAlarms.some((alarm) => alarm.id === ack.id)
        if (!stillExists) {
          return false
        }
        
        // Check if value has worsened (for specific alarms where we track trigger value)
        if (ack.triggerValue !== null) {
          // Lower is worse for these alarms (SpO2, HR low, BP low, etCO2 low)
          if (['spo2-low', 'hr-low', 'abp-low', 'etco2-low'].includes(ack.id)) {
            const currentValue = 
              ack.id === 'spo2-low' ? state.vitals.spo2 :
              ack.id === 'hr-low' ? state.vitals.hr :
              ack.id === 'abp-low' ? state.vitals.nibpSys :
              ack.id === 'etco2-low' ? state.vitals.etco2 : null
            if (currentValue !== null && currentValue < ack.triggerValue) {
              return false // Value worsened, re-trigger alarm
            }
          }
          // Higher is worse for these alarms (HR high, BP high, etCO2 high)
          else if (['hr-high', 'abp-high', 'etco2-high'].includes(ack.id)) {
            const currentValue = 
              ack.id === 'hr-high' ? state.vitals.hr :
              ack.id === 'abp-high' ? state.vitals.nibpSys :
              ack.id === 'etco2-high' ? state.vitals.etco2 : null
            if (currentValue !== null && currentValue > ack.triggerValue) {
              return false // Value worsened, re-trigger alarm
            }
          }
        }
        
        return true
      })
    })
  }, [rawAlarms, now, state.vitals])

  // Track new alarms into history
  useEffect(() => {
    for (const alarm of rawAlarms) {
      if (!prevAlarmIdsRef.current.has(alarm.id)) {
        prevAlarmIdsRef.current.add(alarm.id)
        setAlarmHistory(h => [{ ...alarm, time: new Date() }, ...h.slice(0, 19)])
      }
    }
    for (const id of Array.from(prevAlarmIdsRef.current)) {
      if (!rawAlarms.find(a => a.id === id)) {
        prevAlarmIdsRef.current.delete(id)
      }
    }
  }, [rawAlarms])

  const activeAlarms = alarmsPaused
    ? []
    : rawAlarms.filter((alarm) => !acknowledgedAlarms.some((ack) => ack.id === alarm.id))

  const hasActiveAlarmById = (id: string, level?: 'red' | 'yellow') => activeAlarms.some((alarm) => alarm.id === id && (level ? alarm.level === level : true))
  const metricAlarmState = (ids: string[]): AlarmLevel => {
    const hasCritical = ids.some((id) => hasActiveAlarmById(id, 'red'))
    if (hasCritical) return 'critical'
    const hasWarning = ids.some((id) => hasActiveAlarmById(id, 'yellow'))
    return hasWarning ? 'warning' : 'normal'
  }

  const hrAlarmState = metricAlarmState(['hr-high', 'hr-low'])
  const spo2AlarmState = metricAlarmState(['spo2-low'])
  const abpAlarmState = metricAlarmState(['abp-low', 'abp-high'])
  const etco2AlarmState = metricAlarmState(['etco2-low', 'etco2-high'])
  const rrAlarmState = metricAlarmState(['rr-low', 'rr-high'])

  // Cycle through multiple alarms every 2 s
  useEffect(() => {
    if (activeAlarms.length <= 1) { setAlarmDisplayIndex(0); return }
    const id = setInterval(() => setAlarmDisplayIndex(i => (i + 1) % activeAlarms.length), 2000)
    return () => clearInterval(id)
  }, [activeAlarms.length])

  const displayedAlarm = activeAlarms[alarmDisplayIndex % Math.max(activeAlarms.length, 1)] ?? null
  const activeSound = state.soundLibrary.find((item) => item.id === state.activeSoundId) ?? null
  const shouldPlayAlarmSound = !!activeSound && activeAlarms.length > 0 && !standby

  useEffect(() => {
    const audio = alarmAudioRef.current
    if (!audio) return

    audio.loop = true
    audio.muted = false
    audio.volume = clamp(alarmVolume / 10, 0, 1)

    if (shouldPlayAlarmSound) {
      void audio.play().catch(() => {
        // Browser autoplay policies can block play before first user interaction.
        pendingAlarmPlayRef.current = true
      })
      return
    }

    pendingAlarmPlayRef.current = false
    audio.pause()
    audio.currentTime = 0
  }, [shouldPlayAlarmSound, alarmVolume, activeSound?.url])

  // Retry blocked alarm audio automatically on first user interaction.
  useEffect(() => {
    if (!shouldPlayAlarmSound) return

    const retryPlay = () => {
      if (!pendingAlarmPlayRef.current) return
      const audio = alarmAudioRef.current
      if (!audio) return

      void audio.play()
        .then(() => {
          pendingAlarmPlayRef.current = false
        })
        .catch(() => {
          // Keep pending flag; we'll retry on next interaction.
        })
    }

    window.addEventListener('pointerdown', retryPlay)
    window.addEventListener('keydown', retryPlay)
    return () => {
      window.removeEventListener('pointerdown', retryPlay)
      window.removeEventListener('keydown', retryPlay)
    }
  }, [shouldPlayAlarmSound])

  const pauseRemaining = alarmsPausedUntil !== null ? Math.max(0, Math.ceil((alarmsPausedUntil - now.getTime()) / 1000)) : 0
  const pauseMinSec = pauseRemaining > 0
    ? `${Math.floor(pauseRemaining / 60)}:${String(pauseRemaining % 60).padStart(2, '0')}`
    : ''

  const NBP_INTERVALS = [0, 2, 5, 10, 15, 30]
  const cycleNbpInterval = () => {
    const idx = NBP_INTERVALS.indexOf(nbpAutoInterval)
    setNbpAutoInterval(NBP_INTERVALS[(idx + 1) % NBP_INTERVALS.length])
  }
  const nbpAutoLabel = nbpAutoInterval === 0 ? 'NBP Manuell' : `NBP Auto ${nbpAutoInterval}min`
  const nbpCountdownStr = nbpAutoInterval > 0 && nbpAutoRemaining > 0
    ? `${Math.floor(nbpAutoRemaining / 60)}:${String(nbpAutoRemaining % 60).padStart(2, '0')}`
    : null

  const openAlarmLimits = (target: AlarmLimitTarget) => {
    setAlarmLimitTarget(target)
    setShowAlarmLimits(true)
    setShowAlarmReview(false)
    setShowVitalsTrend(false)
    setShowSettings(false)
    setShowPatientSetup(false)
  }

  const acknowledgeActiveAlarms = () => {
    if (activeAlarms.length === 0) {
      return
    }

    setAcknowledgedAlarms((prev) => {
      const merged = new Map(prev.map((ack) => [ack.id, ack]))
      for (const alarm of activeAlarms) {
        // Extract trigger value based on alarm id
        let triggerValue: number | null = null
        if (alarm.id === 'spo2-low') triggerValue = state.vitals.spo2
        else if (alarm.id === 'hr-low') triggerValue = state.vitals.hr
        else if (alarm.id === 'hr-high') triggerValue = state.vitals.hr
        else if (alarm.id === 'abp-low') triggerValue = state.vitals.nibpSys
        else if (alarm.id === 'abp-high') triggerValue = state.vitals.nibpSys
        else if (alarm.id === 'etco2-low') triggerValue = state.vitals.etco2
        else if (alarm.id === 'etco2-high') triggerValue = state.vitals.etco2
        else if (alarm.id === 'rr-low') triggerValue = state.vitals.rr
        else if (alarm.id === 'rr-high') triggerValue = state.vitals.rr

        merged.set(alarm.id, {
          id: alarm.id,
          acknowledgedAt: now.getTime(),
          triggerValue,
        })
      }
      return Array.from(merged.values())
    })
  }

  const toggleAlarmPause = () => {
    if (alarmsPaused) {
      setAlarmsPausedUntil(null)
      return
    }

    setAlarmsPausedUntil(Date.now() + 2 * 60 * 1000)
  }

  const softkeys: Array<{ label: string; accent?: 'warning' | 'primary'; compact?: boolean; onPress?: () => void }> = [
    {
      label: 'Tysta larm',
      accent: activeAlarms.length > 0 ? 'warning' : undefined,
      onPress: acknowledgeActiveAlarms,
    },
    {
      label: alarmsPaused ? `Larm Av ${pauseMinSec}` : 'Larm Av',
      accent: alarmsPaused ? 'warning' : undefined,
      onPress: toggleAlarmPause,
    },
    { label: '<<', compact: true },
    { label: 'NBP Start', onPress: () => { triggerNibpReading?.(); if (nbpAutoInterval > 0) setNbpAutoRemaining(nbpAutoInterval * 60) } },
    { label: nbpAutoLabel, onPress: cycleNbpInterval },
    { label: 'Granska larm', accent: showAlarmReview ? 'primary' : undefined, onPress: () => { setShowAlarmReview(r => !r); setShowVitalsTrend(false); setShowAlarmLimits(false); setShowSettings(false); setShowPatientSetup(false) } },
    { label: 'Larmgränser', accent: showAlarmLimits ? 'primary' : undefined, onPress: () => { if (showAlarmLimits) { setShowAlarmLimits(false); return }; openAlarmLimits(alarmLimitTarget) } },
    { label: 'Vitals trend', accent: showVitalsTrend ? 'primary' : undefined, onPress: () => { setShowVitalsTrend(r => !r); setShowAlarmReview(false); setShowAlarmLimits(false); setShowSettings(false); setShowPatientSetup(false) } },
    { label: 'Patient', accent: showPatientSetup ? 'primary' : undefined, onPress: () => { setShowPatientSetup(p => !p); setShowAlarmReview(false); setShowVitalsTrend(false); setShowAlarmLimits(false); setShowSettings(false) } },
    { label: 'Stand-by', accent: standby ? 'warning' : undefined, onPress: () => setStandby(s => !s) },
    { label: '>>', compact: true },
    { label: frozen ? 'Frys AV' : 'Frys', accent: frozen ? 'primary' : undefined, onPress: () => { setFrozen(f => !f); if (!frozen) setFrozenAt(new Date()) } },
    { label: 'Inst.', accent: showSettings ? 'primary' : undefined, onPress: () => { setShowSettings(r => !r); setShowAlarmReview(false); setShowVitalsTrend(false); setShowAlarmLimits(false); setShowPatientSetup(false) } },
    { label: 'Huvudskärm', accent: 'primary' },
  ]

  const bannerVariant = activeAlarms.length > 0
    ? displayedAlarm?.level ?? 'yellow'
    : alarmsPaused ? 'silenced'
    : 'clear'

  return (
    <section className="monitor-screen intellivue-shell">
      {activeSound ? <audio ref={alarmAudioRef} src={activeSound.url} preload="auto" autoPlay={shouldPlayAlarmSound} loop playsInline /> : null}
      {/* Stand-by overlay */}
      {standby && (
        <div className="intel-standby" onClick={() => setStandby(false)}>
          <span>STAND-BY</span>
          <small>Tryck för att återuppta</small>
        </div>
      )}

      {/* Alarm review overlay */}
      {showAlarmReview && (
        <div className="intel-overlay">
          <div className="intel-overlay-header">
            <span>Granska Larm</span>
            <button type="button" onClick={() => setShowAlarmReview(false)}>✕</button>
          </div>
          {alarmHistory.length === 0
            ? <p className="intel-overlay-empty">Inga larm registrerade</p>
            : alarmHistory.map((a, i) => (
              <div key={i} className={`intel-alarm-row ${a.level}`}>
                <span className="intel-alarm-row-time">
                  {a.time.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span>{a.text}</span>
              </div>
            ))
          }
        </div>
      )}

      {/* Alarm limits overlay */}
      {showAlarmLimits && (
        <div className="intel-overlay intel-overlay-wide">
          <div className="intel-overlay-header">
            <span>Larmgränser</span>
            <button type="button" onClick={() => setShowAlarmLimits(false)}>✕</button>
          </div>
          <table className="intel-limits-table">
            <thead><tr><th>Parameter</th><th>Låg</th><th></th><th>Hög</th><th></th></tr></thead>
            <tbody>
              <tr className={alarmLimitTarget === 'hr' ? 'intel-limit-row-active' : ''}>
                <td>HF</td>
                <td>{hrLow}</td>
                <td><button type="button" onClick={() => setHrLow(v => Math.max(20, v - 5))}>−</button><button type="button" onClick={() => setHrLow(v => Math.min(hrHigh - 5, v + 5))}>+</button></td>
                <td>{hrHigh}</td>
                <td><button type="button" onClick={() => setHrHigh(v => Math.max(hrLow + 5, v - 5))}>−</button><button type="button" onClick={() => setHrHigh(v => Math.min(300, v + 5))}>+</button></td>
              </tr>
              <tr className={alarmLimitTarget === 'spo2' ? 'intel-limit-row-active' : ''}>
                <td>SpO2 låg</td>
                <td>{spo2Low}</td>
                <td><button type="button" onClick={() => setSpo2Low(v => Math.max(50, v - 1))}>−</button><button type="button" onClick={() => setSpo2Low(v => Math.min(99, v + 1))}>+</button></td>
                <td>—</td><td></td>
              </tr>
              <tr className={alarmLimitTarget === 'abp' ? 'intel-limit-row-active' : ''}>
                <td>ABP sys</td>
                <td>{abpLow}</td>
                <td><button type="button" onClick={() => setAbpLow(v => Math.max(40, v - 5))}>−</button><button type="button" onClick={() => setAbpLow(v => Math.min(abpHigh - 5, v + 5))}>+</button></td>
                <td>{abpHigh}</td>
                <td><button type="button" onClick={() => setAbpHigh(v => Math.max(abpLow + 5, v - 5))}>−</button><button type="button" onClick={() => setAbpHigh(v => Math.min(300, v + 5))}>+</button></td>
              </tr>
              <tr className={alarmLimitTarget === 'etco2' ? 'intel-limit-row-active' : ''}>
                <td>etCO2</td>
                <td>{etco2Low}</td>
                <td><button type="button" onClick={() => setEtco2Low(v => Math.max(0, v - 1))}>−</button><button type="button" onClick={() => setEtco2Low(v => Math.min(etco2High - 1, v + 1))}>+</button></td>
                <td>{etco2High}</td>
                <td><button type="button" onClick={() => setEtco2High(v => Math.max(etco2Low + 1, v - 1))}>−</button><button type="button" onClick={() => setEtco2High(v => Math.min(20, v + 1))}>+</button></td>
              </tr>
              <tr className={alarmLimitTarget === 'rr' ? 'intel-limit-row-active' : ''}>
                <td>RF</td>
                <td>{rrLow}</td>
                <td><button type="button" onClick={() => setRrLow(v => Math.max(4, v - 1))}>−</button><button type="button" onClick={() => setRrLow(v => Math.min(rrHigh - 1, v + 1))}>+</button></td>
                <td>{rrHigh}</td>
                <td><button type="button" onClick={() => setRrHigh(v => Math.max(rrLow + 1, v - 1))}>−</button><button type="button" onClick={() => setRrHigh(v => Math.min(60, v + 1))}>+</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Vitals trend overlay */}
      {showVitalsTrend && (
        <div className="intel-overlay intel-overlay-wide">
          <div className="intel-overlay-header">
            <span>Vitalstrend (15 min)</span>
            <button type="button" onClick={() => setShowVitalsTrend(false)}>✕</button>
          </div>
          {vitalsTrendSnapshot.length === 0
            ? <p className="intel-overlay-empty">Inga trenddata ännu. Samlas var 60:e sekund.</p>
            : (
              <table className="intel-trend-table">
                <thead><tr><th>Tid</th><th>HF</th><th>SpO2</th><th>ABP sys/dia</th>{showRr && <th>RF</th>}{showTemp && <th>Temp</th>}</tr></thead>
                <tbody>
                  {vitalsTrendSnapshot.map((e, i) => (
                    <tr key={i}>
                      <td>{e.time.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{e.hr}</td>
                      <td>{e.spo2}%</td>
                      <td>{e.sys}/{e.dia}</td>
                      {showRr && <td>{e.rr}</td>}
                      {showTemp && <td>{e.temp.toFixed(1)}°</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {/* Patient / volume setup overlay */}
      {showPatientSetup && (
        <div className="intel-overlay">
          <div className="intel-overlay-header">
            <span>Patientinformation</span>
            <button type="button" onClick={() => setShowPatientSetup(false)}>✕</button>
          </div>
          <div className="intel-overlay-section-label">Patientkategori</div>
          <div className="intel-patient-cats">
            {(['Vuxen', 'Barn', 'Neonatal'] as const).map(cat => (
              <button
                key={cat}
                type="button"
                className={patientCategory === cat ? 'active' : ''}
                onClick={() => { setPatientCategory(cat); setShowPatientSetup(false) }}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="intel-overlay-section-label">Larmvolym</div>
          <div className="intel-volume-btns">
            {[0, 2, 4, 6, 8, 10].map(v => (
              <button key={v} type="button" className={alarmVolume === v ? 'active' : ''} onClick={() => setAlarmVolume(v)}>
                {v === 0 ? 'Av' : v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings overlay */}
      {showSettings && (
        <div className="intel-overlay">
          <div className="intel-overlay-header">
            <span>Inställningar</span>
            <button type="button" onClick={() => setShowSettings(false)}>✕</button>
          </div>
          <div className="intel-overlay-section-label">EKG-filter</div>
          <div className="intel-patient-cats">
            {(['Monitor', 'Diagnostik', 'Kirurgi'] as const).map(f => (
              <button key={f} type="button" className={ekgFilter === f ? 'active' : ''} onClick={() => setEkgFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="intel-overlay-section-label">Kurvhastighet (mm/s)</div>
          <div className="intel-patient-cats">
            {([12.5, 25, 50] as const).map(s => (
              <button key={s} type="button" className={waveSpeed === s ? 'active' : ''} onClick={() => setWaveSpeed(s)}>{s}</button>
            ))}
          </div>
          <div className="intel-overlay-section-label">QRS-ton</div>
          <div className="intel-patient-cats">
            <button type="button" className={qrsTone ? 'active' : ''} onClick={() => setQrsTone(true)}>På</button>
            <button type="button" className={!qrsTone ? 'active' : ''} onClick={() => setQrsTone(false)}>Av</button>
          </div>
        </div>
      )}

      <div className="intel-topbar">
        <div className="intel-topbar-inner">
          <span className="intel-topbar-datetime">{dateStr}&nbsp;&nbsp;{timeStr}</span>
          <span className="intel-topbar-profile">
            &#9670;&nbsp;{patientCategory}&nbsp;&nbsp;
            {alarmVolume === 0 ? '🔇' : '🔔'}&nbsp;{alarmVolume}
            {frozen && <span className="intel-frozen-badge">&nbsp;â„ FRYST {frozenAt?.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </span>
        </div>
      </div>

      {/* Alarm banner — larmfält */}
      <div
        className={`intel-alarm-banner ${bannerVariant}`}
        role="alert"
        onClick={() => { if (activeAlarms.length > 0) setShowAlarmReview(true) }}
      >
        {activeAlarms.length > 0 && displayedAlarm
          ? <span>{displayedAlarm.level === 'red' ? '★★★' : '★★'}&nbsp;{displayedAlarm.text}{activeAlarms.length > 1 ? ` ▸ (${activeAlarms.length})` : ''}</span>
          : alarmsPaused
            ? <span>LARMPAUS&nbsp;{pauseMinSec}</span>
            : <span>&nbsp;</span>
        }
      </div>

      <div className="intel-main">
        <div className="intel-row">
          <div className="wave-strip ecg">
            <button
              ref={ekgButtonRef}
              type="button"
              className="wave-label wave-label-btn"
              onClick={(e) => {
                const rect = (e.target as HTMLElement).getBoundingClientRect()
                setEkgPopupPos({ top: rect.bottom + 4, left: rect.right + 4 })
                setShowEkgLeadSelector(true)
              }}
            >
              EKG {ekgLead} ▸
            </button>
            <Waveform rhythm={frozen ? 'sinus' : state.rhythm} alarmLevel={state.alarmLevel} compact variant="ecg" rate={state.vitals.hr} flatline={!parameterVisibility.hr} />
          </div>
          <div className="intel-metric-slot">
            <IntellivueMetric label="HR" value={parameterVisibility.hr ? state.vitals.hr : ''} low={hrLow} high={hrHigh} tone="green" alarmState={hrAlarmState} inactive={!parameterVisibility.hr} onClick={() => openAlarmLimits('hr')} selected={showAlarmLimits && alarmLimitTarget === 'hr'} />
          </div>
        </div>

        <div className="intel-row">
          <div className="wave-strip pleth">
            <span className="wave-label">Pleth</span>
            <Waveform rhythm={frozen ? 'sinus' : state.rhythm} alarmLevel={state.alarmLevel} compact variant="pleth" rate={state.vitals.hr} flatline={!showSpo2} />
          </div>
          <div className="intel-metric-slot">
            <IntellivueMetric label="SpO2" value={showSpo2 ? state.vitals.spo2 : ''} low={spo2Low} high={100} tone="blue" alarmState={spo2AlarmState} inactive={!showSpo2} onClick={() => openAlarmLimits('spo2')} selected={showAlarmLimits && alarmLimitTarget === 'spo2'} />
          </div>
        </div>

        <div className="intel-row">
          <div className="wave-strip abp">
            <span className="wave-label">ABP</span>
            <Waveform rhythm={frozen ? 'sinus' : state.rhythm} alarmLevel={state.alarmLevel} compact variant="abp" rate={state.vitals.hr} flatline={!showAbpWave} />
          </div>
          <div className="intel-metric-slot">
            <IntellivueMetric label="ABP" value={parameterVisibility.abp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia}` : ''} low={abpLow} high={abpHigh} tone="red" alarmState={abpAlarmState} inactive={!parameterVisibility.abp} secondary={parameterVisibility.abp ? `(${state.vitals.map})` : ''} onClick={() => openAlarmLimits('abp')} selected={showAlarmLimits && alarmLimitTarget === 'abp'} />
          </div>
        </div>

        <div className="intel-row">
          <div className="wave-strip etco2">
            <span className="wave-label">CO2</span>
            <Waveform rhythm={frozen ? 'sinus' : state.rhythm} alarmLevel={state.alarmLevel} compact variant="etco2" rate={state.vitals.hr} flatline={!showEtco2} />
          </div>
          <div className="intel-metric-slot">
            <IntellivueMetric label="etCO2" value={showEtco2 ? formatEtco2Kpa(state.vitals.etco2) : ''} low={etco2Low} high={etco2High} tone="white" alarmState={etco2AlarmState} inactive={!showEtco2} onClick={() => openAlarmLimits('etco2')} selected={showAlarmLimits && alarmLimitTarget === 'etco2'} />
          </div>
        </div>

        {showRr && (
          <div className="intel-row">
            <div className="wave-strip resp">
              <span className="wave-label">Resp</span>
              <Waveform rhythm={frozen ? 'sinus' : state.rhythm} alarmLevel={state.alarmLevel} compact variant="resp" rate={state.vitals.rr} flatline={false} />
            </div>
            <div className="intel-metric-slot">
              <IntellivueMetric label="RF" value={state.vitals.rr} low={rrLow} high={rrHigh} tone="white" alarmState={rrAlarmState} inactive={false} onClick={() => openAlarmLimits('rr')} selected={showAlarmLimits && alarmLimitTarget === 'rr'} />
            </div>
          </div>
        )}
      </div>

      <div className="intel-bottom">
        <div className={`nibp-panel ${abpAlarmState !== 'normal' ? abpAlarmState : ''} ${state.nibpReading ? '' : 'muted'}`}>
          <p>NIBP{nbpAutoInterval > 0 ? ` — ${nbpAutoLabel}` : ''}</p>
          <strong>
            {state.nibpReading
              ? `${state.nibpReading.sys}/${state.nibpReading.dia} (${state.nibpReading.map})`
              : '---'}
          </strong>
          {nbpCountdownStr && <small className="nibp-countdown">Nästa: {nbpCountdownStr}</small>}
        </div>
        {showTemp && (
          <div className="intel-temp-panel">
            <p>Temp</p>
            <strong>{state.vitals.temp.toFixed(1)} °C</strong>
          </div>
        )}
      </div>

      {showEkgLeadSelector && ekgPopupPos && (
        <div
          className="ekg-popup-overlay"
          onClick={() => setShowEkgLeadSelector(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
        >
          <div
            className="ekg-popup"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${ekgPopupPos.top}px`,
              left: `${ekgPopupPos.left}px`,
              zIndex: 41,
              background: '#0d1e28ee',
              border: '1px solid #2a4050',
              borderRadius: '4px',
              padding: '0.4rem',
            }}
          >
            <div className="ekg-popup-leads">
              {EKG_LEADS.map((lead) => (
                <button
                  key={lead}
                  type="button"
                  className={`ekg-popup-btn ${lead === ekgLead ? 'active' : ''}`}
                  onClick={() => {
                    setEkgLead(lead)
                    setShowEkgLeadSelector(false)
                  }}
                >
                  {lead}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="intel-command-bar" aria-label="Monitorfunktioner">
        {softkeys.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`intel-softkey ${item.accent ? item.accent : ''} ${item.compact ? 'compact' : ''}`.trim()}
            onClick={item.onPress}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

const X2TransportMonitor = ({
  state,
  triggerNibpReading,
}: {
  state: SimulationState
  triggerNibpReading?: () => void
}) => {
  const [now, setNow] = useState(() => new Date())
  const [alarmsPausedUntil, setAlarmsPausedUntil] = useState<number | null>(null)
  const [silencedAlarmSignature, setSilencedAlarmSignature] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [nbpIntervalSeconds, setNbpIntervalSeconds] = useState(0)
  const [waveGainIndex, setWaveGainIndex] = useState(1)
  const [waveSpeedIndex, setWaveSpeedIndex] = useState(0)
  const [hrLowLimit, setHrLowLimit] = useState<number>(ALARM_LIMITS.hr.low)
  const [hrHighLimit, setHrHighLimit] = useState<number>(ALARM_LIMITS.hr.high)
  const [spo2LowLimit, setSpo2LowLimit] = useState<number>(ALARM_LIMITS.spo2.low)
  const [nibpSysLowLimit] = useState<number>(ALARM_LIMITS.abpSys.low)
  const [nibpSysHighLimit] = useState<number>(ALARM_LIMITS.abpSys.high)
  const warningAlarmAudioRef = useRef<HTMLAudioElement | null>(null)
  const criticalAlarmAudioRef = useRef<HTMLAudioElement | null>(null)
  const [localVisibility, setLocalVisibility] = useState({
    hr: true,
    spo2: true,
    abp: true,
    temp: true,
  })

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (nbpIntervalSeconds <= 0 || !triggerNibpReading) {
      return undefined
    }

    const id = window.setInterval(() => {
      triggerNibpReading()
    }, nbpIntervalSeconds * 1000)

    return () => window.clearInterval(id)
  }, [nbpIntervalSeconds, triggerNibpReading])

  const { parameterVisibility } = state
  const hideSpo2Value = state.vitals.nibpSys < 60
  const showHr = parameterVisibility.hr && localVisibility.hr
  const showSpo2 = parameterVisibility.spo2 && localVisibility.spo2 && !hideSpo2Value
  const showAbp = parameterVisibility.abp && localVisibility.abp
  const showTemp = parameterVisibility.temp && localVisibility.temp
  const hrCriticalLowLimit = Math.max(30, hrLowLimit - 20)
  const hrCriticalHighLimit = hrHighLimit + 30
  const spo2CriticalLowLimit = Math.max(70, spo2LowLimit - 5)
  const nibpSysCriticalLowLimit = Math.max(50, nibpSysLowLimit - 20)
  const nibpSysCriticalHighLimit = nibpSysHighLimit + 20
  const hrCritical = parameterVisibility.hr && (state.vitals.hr < hrCriticalLowLimit || state.vitals.hr > hrCriticalHighLimit)
  const spo2Critical = parameterVisibility.spo2 && state.vitals.spo2 < spo2CriticalLowLimit
  const nibpSysCritical = parameterVisibility.abp && (state.vitals.nibpSys < nibpSysCriticalLowLimit || state.vitals.nibpSys > nibpSysCriticalHighLimit)
  const hrOutOfRange = parameterVisibility.hr && (state.vitals.hr < hrLowLimit || state.vitals.hr > hrHighLimit)
  const spo2OutOfRange = parameterVisibility.spo2 && state.vitals.spo2 < spo2LowLimit
  const nibpSysOutOfRange = parameterVisibility.abp && (state.vitals.nibpSys < nibpSysLowLimit || state.vitals.nibpSys > nibpSysHighLimit)
  const timeString = now.toLocaleTimeString('en-GB', { minute: '2-digit', second: '2-digit' })
  const waveGainClass = `gain-${waveGainIndex}`
  const waveSpeedClass = `speed-${waveSpeedIndex}`
  const hasThresholdCritical = hrCritical || spo2Critical || nibpSysCritical
  const hasThresholdWarning = hrOutOfRange || spo2OutOfRange || nibpSysOutOfRange
  const activeAlarmLevel: AlarmLevel = state.alarmLevel === 'critical' || hasThresholdCritical
    ? 'critical'
    : (state.alarmLevel === 'warning' || hasThresholdWarning ? 'warning' : 'normal')
  const hasActiveAlarm = activeAlarmLevel !== 'normal'
  const activeAlarmSignature = `${activeAlarmLevel}:${hrOutOfRange ? '1' : '0'}:${spo2OutOfRange ? '1' : '0'}:${nibpSysOutOfRange ? '1' : '0'}:${hrCritical ? '1' : '0'}:${spo2Critical ? '1' : '0'}:${nibpSysCritical ? '1' : '0'}`
  const alarmsPaused = alarmsPausedUntil !== null && alarmsPausedUntil > now.getTime()
  const pauseRemainingSeconds = alarmsPausedUntil === null ? 0 : Math.max(0, Math.ceil((alarmsPausedUntil - now.getTime()) / 1000))
  const alarmsSilenced = hasActiveAlarm && silencedAlarmSignature === activeAlarmSignature
  const alarmsSuppressed = alarmsPaused || alarmsSilenced
  const displayAlarmLevel: AlarmLevel = alarmsSuppressed ? 'normal' : activeAlarmLevel
  const showHrCritical = showHr && hrCritical && !alarmsSuppressed
  const showSpo2Critical = showSpo2 && spo2Critical && !alarmsSuppressed
  const showNibpCritical = showAbp && nibpSysCritical && !alarmsSuppressed
  const showHrWarning = showHr && hrOutOfRange && !hrCritical && !alarmsSuppressed
  const showSpo2Warning = showSpo2 && spo2OutOfRange && !spo2Critical && !alarmsSuppressed
  const showNibpWarning = showAbp && nibpSysOutOfRange && !nibpSysCritical && !alarmsSuppressed
  const alarmReasons: string[] = []
  if (showHrCritical) {
    alarmReasons.push(`KRITISK HR ${state.vitals.hr} (kritisk grans ${hrCriticalLowLimit}-${hrCriticalHighLimit})`)
  } else if (showHrWarning) {
    alarmReasons.push(`HR ${state.vitals.hr} (grans ${hrLowLimit}-${hrHighLimit})`)
  }
  if (showSpo2Critical) {
    alarmReasons.push(`KRITISK SpO2 ${state.vitals.spo2}% (kritisk lagst ${spo2CriticalLowLimit}%)`)
  } else if (showSpo2Warning) {
    alarmReasons.push(`SpO2 ${state.vitals.spo2}% (lagst ${spo2LowLimit}%)`)
  }
  if (showNibpCritical) {
    alarmReasons.push(`KRITISK NIBP SYS ${state.vitals.nibpSys} (kritisk grans ${nibpSysCriticalLowLimit}-${nibpSysCriticalHighLimit})`)
  } else if (showNibpWarning) {
    alarmReasons.push(`NIBP SYS ${state.vitals.nibpSys} (grans ${nibpSysLowLimit}-${nibpSysHighLimit})`)
  }
  const alarmPrimaryReason = alarmReasons[0] ?? 'Kontrollera patient'
  const alarmPauseMinutes = String(Math.floor(pauseRemainingSeconds / 60)).padStart(2, '0')
  const alarmPauseSeconds = String(pauseRemainingSeconds % 60).padStart(2, '0')
  const alarmStatusText = alarmsPaused
    ? `ALARMS PAUSED ${alarmPauseMinutes}:${alarmPauseSeconds}`
    : alarmsSilenced
      ? 'ALARMS OFF'
      : hasActiveAlarm
        ? 'ALARMS ACTIVE'
        : 'ALARMS READY'

  useEffect(() => {
    if (!hasActiveAlarm) {
      setSilencedAlarmSignature(null)
    }
  }, [hasActiveAlarm])

  useEffect(() => {
    warningAlarmAudioRef.current = new Audio(new URL('../Philips soft alarm.m4a', import.meta.url).href)
    criticalAlarmAudioRef.current = new Audio(new URL('../Philips hard alarm.m4a', import.meta.url).href)
    if (warningAlarmAudioRef.current) {
      warningAlarmAudioRef.current.loop = true
      warningAlarmAudioRef.current.volume = 0.5
    }
    if (criticalAlarmAudioRef.current) {
      criticalAlarmAudioRef.current.loop = true
      criticalAlarmAudioRef.current.volume = 0.75
    }

    return () => {
      if (warningAlarmAudioRef.current) {
        warningAlarmAudioRef.current.pause()
      }
      if (criticalAlarmAudioRef.current) {
        criticalAlarmAudioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    const warningAudio = warningAlarmAudioRef.current
    const criticalAudio = criticalAlarmAudioRef.current
    if (!warningAudio || !criticalAudio) {
      return
    }

    const stopAudio = (audio: HTMLAudioElement) => {
      audio.pause()
      audio.currentTime = 0
    }

    if (alarmsSuppressed || activeAlarmLevel === 'normal') {
      stopAudio(warningAudio)
      stopAudio(criticalAudio)
      return
    }

    if (activeAlarmLevel === 'critical') {
      stopAudio(warningAudio)
      criticalAudio.play().catch(() => {})
      return
    }

    stopAudio(criticalAudio)
    warningAudio.play().catch(() => {})
  }, [alarmsSuppressed, activeAlarmLevel])

  const acknowledgeActiveAlarms = () => {
    if (!hasActiveAlarm) {
      return
    }

    setSilencedAlarmSignature(activeAlarmSignature)
    setAlarmsPausedUntil(null)
  }

  const pauseAlarmsForTwoMinutes = () => {
    setAlarmsPausedUntil(Date.now() + 2 * 60 * 1000)
  }

  const toggleLocalVisibility = (parameter: keyof typeof localVisibility) => {
    setLocalVisibility((prev) => ({
      ...prev,
      [parameter]: !prev[parameter],
    }))
  }

  const toggleProfile = () => {
    const enableAll = !(localVisibility.hr && localVisibility.spo2 && localVisibility.abp && localVisibility.temp)
    setLocalVisibility({
      hr: enableAll,
      spo2: enableAll,
      abp: enableAll,
      temp: enableAll,
    })
  }

  const cycleNibpInterval = () => {
    const sequence = [0, 30, 60, 120]
    const currentIndex = sequence.indexOf(nbpIntervalSeconds)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sequence.length
    setNbpIntervalSeconds(sequence[nextIndex])
  }

  const nibpModeLabel = nbpIntervalSeconds === 0 ? 'MANUAL' : `AUTO ${nbpIntervalSeconds}s`

  return (
    <section className="x2-transport-monitor">
      <header className="x2-header">
        <div className="x2-header-left">
          <span className="x2-bed-label">Bed 9</span>
          <span className="x2-patient-class">Adult</span>
        </div>
        <div className="x2-header-right">
          <span className={`x2-alarms-status ${alarmsPaused ? 'paused' : ''} ${hasActiveAlarm && !alarmsSuppressed ? 'active' : ''} ${activeAlarmLevel === 'critical' && !alarmsSuppressed ? 'critical' : ''}`.trim()}>
            {alarmStatusText}
          </span>
        </div>
      </header>

      <div className="x2-main-layout">
        <div className={`x2-left-stack ${hasActiveAlarm && !alarmsSuppressed ? 'alarm-active' : ''} ${activeAlarmLevel === 'critical' && !alarmsSuppressed ? 'alarm-critical' : ''}`.trim()}>
          {hasActiveAlarm && !alarmsSuppressed ? (
            <div className={`x2-alarm-banner ${activeAlarmLevel}`.trim()} role="status" aria-live="assertive">
              <strong>{activeAlarmLevel === 'critical' ? 'KRITISKT LARM' : 'LARM AKTIVT'}</strong>
              <span>{alarmPrimaryReason}</span>
            </div>
          ) : null}

          <div className="x2-large-metrics">
            <div className={`x2-metric-giant x2-metric-hr ${showHrWarning ? 'warning' : ''} ${showHrCritical ? 'critical' : ''}`.trim()}>
              <span className="x2-metric-label">HR</span>
              <span className="x2-metric-value-giant">{showHr ? state.vitals.hr : '—'}</span>
            </div>
            <div className={`x2-metric-giant x2-metric-spo2 ${showSpo2Warning ? 'warning' : ''} ${showSpo2Critical ? 'critical' : ''}`.trim()}>
              <span className="x2-metric-label">SpO2</span>
              <span className="x2-metric-value-giant">{showSpo2 ? state.vitals.spo2 : '—'}</span>
            </div>
          </div>

          <div className={`x2-wave-stack ${waveGainClass} ${waveSpeedClass}`.trim()}>
            <div className="x2-wave-strip ecg-strip">
              <span className="x2-strip-label">II</span>
              <Waveform rhythm={state.rhythm} alarmLevel={displayAlarmLevel} compact variant="ecg" rate={state.vitals.hr} flatline={!parameterVisibility.hr} />
              <span className="x2-rhythm-label">Sinus Rhythm</span>
            </div>
            <div className="x2-wave-strip abp-strip">
              <span className="x2-strip-label">ABP</span>
              <Waveform rhythm={state.rhythm} alarmLevel={displayAlarmLevel} compact variant="abp" rate={state.vitals.hr} flatline={!showAbp} />
            </div>
          </div>

          <div className="x2-bottom-info">
            <div className={`x2-abp-values ${showNibpWarning ? 'warning' : ''} ${showNibpCritical ? 'critical' : ''}`.trim()}>
              <span className="x2-label">NIBP</span>
              <span className="x2-value">{showAbp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia}` : '—/—'}</span>
              <span className="x2-map">({showAbp ? state.vitals.map : '—'})</span>
            </div>
            <div className="x2-temp-display">
              <span className="x2-label">Temp</span>
              <span className="x2-value">{showTemp ? formatTemp(state.vitals.temp) : '—'}</span>
            </div>
            <div className="x2-time-display">{timeString}</div>
          </div>

          {setupOpen ? (
            <div className="x2-setup-panel" aria-label="X2 setup menu">
              <div className="x2-setup-row">
                <strong>Measurements</strong>
                <button type="button" onClick={toggleProfile}>Toggle all</button>
              </div>
              <div className="x2-setup-switches">
                <button type="button" className={showHr ? 'on' : ''} onClick={() => toggleLocalVisibility('hr')}>HR</button>
                <button type="button" className={showSpo2 ? 'on' : ''} onClick={() => toggleLocalVisibility('spo2')}>SpO2</button>
                <button type="button" className={showAbp ? 'on' : ''} onClick={() => toggleLocalVisibility('abp')}>ABP</button>
                <button type="button" className={showTemp ? 'on' : ''} onClick={() => toggleLocalVisibility('temp')}>Temp</button>
              </div>
              <div className="x2-setup-row">
                <strong>NBP Mode</strong>
                <span>{nibpModeLabel}</span>
              </div>
              <div className="x2-setup-row">
                <strong>HR Limits</strong>
                <span>{`${hrLowLimit} - ${hrHighLimit}`}</span>
              </div>
              <div className="x2-setup-adjust">
                <button type="button" onClick={() => setHrLowLimit((v) => Math.max(30, v - 5))}>HR Low -</button>
                <button type="button" onClick={() => setHrHighLimit((v) => Math.min(220, v + 5))}>HR High +</button>
              </div>
              <div className="x2-setup-row">
                <strong>SpO2 Low</strong>
                <span>{spo2LowLimit}</span>
              </div>
              <div className="x2-setup-adjust">
                <button type="button" onClick={() => setSpo2LowLimit((v) => Math.max(70, v - 1))}>SpO2 -</button>
                <button type="button" onClick={() => setSpo2LowLimit((v) => Math.min(99, v + 1))}>SpO2 +</button>
              </div>
            </div>
          ) : null}

        </div>

        <aside className="x2-control-panel" aria-label="Control buttons">
          <button
            type="button"
            className={`x2-control-btn x2-btn-orange ${alarmsSilenced ? 'active' : ''}`.trim()}
            aria-label="Acknowledge active alarms"
            title="Acknowledge active alarms"
            onClick={acknowledgeActiveAlarms}
          />
          <button
            type="button"
            className={`x2-control-btn x2-btn-ring ${alarmsPaused ? 'active' : ''}`.trim()}
            aria-label="Pause alarms for 2 minutes"
            title="Pause alarms for 2 minutes"
            onClick={pauseAlarmsForTwoMinutes}
          />
          <button
            type="button"
            className={`x2-control-btn x2-btn-gray ${nbpIntervalSeconds > 0 ? 'active' : ''}`.trim()}
            aria-label="Cycle NBP mode"
            title="Cycle NBP mode"
            onClick={cycleNibpInterval}
          />
          <button
            type="button"
            className="x2-control-btn x2-btn-blue"
            aria-label="Adjust wave"
            title="Adjust wave size and speed"
            onClick={() => {
              setWaveGainIndex((prev) => (prev + 1) % 3)
              setWaveSpeedIndex((prev) => (prev + 1) % 2)
            }}
          />
          <button
            type="button"
            className="x2-control-btn x2-btn-knob"
            aria-label="Open setup menu"
            title="Open setup menu"
            onClick={() => setSetupOpen((prev) => !prev)}
          />
        </aside>
      </div>
    </section>
  )
}

const X3PatientMonitor = ({ state }: { state: SimulationState }) => {
  const [now, setNow] = useState(() => new Date())
  const [alarmsPausedUntil, setAlarmsPausedUntil] = useState<number | null>(null)
  const [silencedAlarmSignature, setSilencedAlarmSignature] = useState<string | null>(null)
  const [alarmDisplayIndex, setAlarmDisplayIndex] = useState(0)
  const warningBreachSinceRef = useRef<{ hr: number | null; spo2: number | null; nibp: number | null }>({
    hr: null,
    spo2: null,
    nibp: null,
  })
  const warningAlarmAudioRef = useRef<HTMLAudioElement | null>(null)
  const criticalAlarmAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { parameterVisibility } = state
  const nowMs = now.getTime()
  const hrLowLimit = ALARM_LIMITS.hr.low
  const hrHighLimit = ALARM_LIMITS.hr.high
  const spo2LowLimit = ALARM_LIMITS.spo2.low
  const nibpSysLowLimit = ALARM_LIMITS.abpSys.low
  const nibpSysHighLimit = ALARM_LIMITS.abpSys.high
  const hrCriticalLowLimit = Math.max(30, hrLowLimit - 20)
  const hrCriticalHighLimit = hrHighLimit + 30
  const spo2CriticalLowLimit = Math.max(70, spo2LowLimit - 5)
  const nibpSysCriticalLowLimit = Math.max(50, nibpSysLowLimit - 20)
  const nibpSysCriticalHighLimit = nibpSysHighLimit + 20
  const hideSpo2Value = state.vitals.nibpSys < 60
  const showSpo2 = parameterVisibility.spo2 && !hideSpo2Value
  const showResp = parameterVisibility.rr
  const showHr = parameterVisibility.hr
  const showAbp = parameterVisibility.abp
  // Philips X3 standard: 6.25 mm/s paper speed for respiration waveform
  const x3RespPerMin = state.vitals.rr
  const smartAlarmDelayMs = 10000
  const hrCritical = showHr && (state.vitals.hr < hrCriticalLowLimit || state.vitals.hr > hrCriticalHighLimit)
  const spo2Critical = showSpo2 && state.vitals.spo2 < spo2CriticalLowLimit
  const nibpCritical = showAbp && (state.vitals.nibpSys < nibpSysCriticalLowLimit || state.vitals.nibpSys > nibpSysCriticalHighLimit)
  const updateWarningDelay = (key: 'hr' | 'spo2' | 'nibp', isBreached: boolean) => {
    if (!isBreached) {
      warningBreachSinceRef.current[key] = null
      return false
    }

    const since = warningBreachSinceRef.current[key]
    if (since === null) {
      warningBreachSinceRef.current[key] = nowMs
      return false
    }

    return nowMs - since >= smartAlarmDelayMs
  }

  const hrWarningBreached = showHr && !hrCritical && (state.vitals.hr < hrLowLimit || state.vitals.hr > hrHighLimit)
  const spo2WarningBreached = showSpo2 && !spo2Critical && state.vitals.spo2 < spo2LowLimit
  const nibpWarningBreached = showAbp && !nibpCritical && (state.vitals.nibpSys < nibpSysLowLimit || state.vitals.nibpSys > nibpSysHighLimit)
  const hrWarning = updateWarningDelay('hr', hrWarningBreached)
  const spo2Warning = updateWarningDelay('spo2', spo2WarningBreached)
  const nibpWarning = updateWarningDelay('nibp', nibpWarningBreached)
  type AlarmEntry = { id: string; text: string; level: 'red' | 'yellow' }
  const alarmEntries: AlarmEntry[] = []

  if (state.rhythm === 'vfib') alarmEntries.push({ id: 'vfib', text: 'Kammarflimmer', level: 'red' })
  else if (state.rhythm === 'vtach') alarmEntries.push({ id: 'vtach', text: 'Kammartakykardi', level: 'red' })
  else if (state.rhythm === 'asystole') alarmEntries.push({ id: 'asystole', text: 'Asystoli', level: 'red' })
  else if (state.rhythm === 'afib') alarmEntries.push({ id: 'afib', text: 'Förmaksflimmer', level: 'yellow' })

  if (hrCritical) {
    alarmEntries.push({ id: 'hr-critical', text: `HR kritisk ${state.vitals.hr}`, level: 'red' })
  } else if (hrWarning) {
    alarmEntries.push({ id: 'hr-warning', text: `HR utanför gräns ${state.vitals.hr}`, level: 'yellow' })
  }

  if (spo2Critical) {
    alarmEntries.push({ id: 'spo2-critical', text: `SpO2 kritisk ${state.vitals.spo2}%`, level: 'red' })
  } else if (spo2Warning) {
    alarmEntries.push({ id: 'spo2-warning', text: `SpO2 låg ${state.vitals.spo2}%`, level: 'yellow' })
  }

  if (nibpCritical) {
    alarmEntries.push({ id: 'nbp-critical', text: `NBP kritisk ${state.vitals.nibpSys}/${state.vitals.nibpDia}`, level: 'red' })
  } else if (nibpWarning) {
    alarmEntries.push({ id: 'nbp-warning', text: `NBP utanför gräns ${state.vitals.nibpSys}/${state.vitals.nibpDia}`, level: 'yellow' })
  }

  const hasCriticalAlarm = alarmEntries.some((alarm) => alarm.level === 'red')
  const hasWarningAlarm = alarmEntries.some((alarm) => alarm.level === 'yellow')
  const baseAlarmLevel: AlarmLevel = hasCriticalAlarm
    ? 'critical'
    : hasWarningAlarm
      ? 'warning'
      : 'normal'
  const alarmSignature = alarmEntries
    .map((alarm) => `${alarm.id}:${alarm.level}`)
    .sort()
    .join('|')
  const hasActiveAlarm = baseAlarmLevel !== 'normal'
  const alarmsPaused = alarmsPausedUntil !== null && alarmsPausedUntil > nowMs
  const alarmsSilenced = hasActiveAlarm && silencedAlarmSignature === alarmSignature
  const alarmsSuppressed = alarmsPaused || alarmsSilenced
  const x3AlarmLevel: AlarmLevel = alarmsSuppressed ? 'normal' : baseAlarmLevel
  const activeAlarms = alarmsSuppressed ? [] : alarmEntries
  const displayedAlarm = activeAlarms[alarmDisplayIndex % Math.max(activeAlarms.length, 1)] ?? null
  const x3NbpModeLabel = 'Man'
  const centerTimer = now.toLocaleTimeString('en-GB', { minute: '2-digit', second: '2-digit' })
  const clockDisplay = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const pauseRemainingSeconds = alarmsPausedUntil === null ? 0 : Math.max(0, Math.ceil((alarmsPausedUntil - nowMs) / 1000))
  const pauseMinSec = `${Math.floor(pauseRemainingSeconds / 60)}:${String(pauseRemainingSeconds % 60).padStart(2, '0')}`
  const x3TopbarState = activeAlarms.length > 0
    ? displayedAlarm?.level ?? 'yellow'
    : alarmsPaused
      ? 'paused'
      : alarmsSilenced
        ? 'silenced'
        : 'normal'
  const x3TopbarText = activeAlarms.length > 0 && displayedAlarm
    ? `${displayedAlarm.level === 'red' ? '★★★' : '★★'} ${displayedAlarm.text}${activeAlarms.length > 1 ? ` (${activeAlarms.length})` : ''}`
    : alarmsPaused
      ? `Larm paus ${pauseMinSec}`
      : alarmsSilenced
        ? 'Larm ljud av'
        : centerTimer

  useEffect(() => {
    if (!hasActiveAlarm) {
      setSilencedAlarmSignature(null)
    }
  }, [hasActiveAlarm])

  useEffect(() => {
    if (activeAlarms.length <= 1) {
      setAlarmDisplayIndex(0)
      return
    }

    const id = window.setInterval(() => {
      setAlarmDisplayIndex((prev) => (prev + 1) % activeAlarms.length)
    }, 2000)
    return () => window.clearInterval(id)
  }, [activeAlarms.length])

  useEffect(() => {
    warningAlarmAudioRef.current = new Audio(new URL('../Philips soft alarm.m4a', import.meta.url).href)
    criticalAlarmAudioRef.current = new Audio(new URL('../Philips hard alarm.m4a', import.meta.url).href)
    if (warningAlarmAudioRef.current) {
      warningAlarmAudioRef.current.loop = true
      warningAlarmAudioRef.current.volume = 0.5
    }
    if (criticalAlarmAudioRef.current) {
      criticalAlarmAudioRef.current.loop = true
      criticalAlarmAudioRef.current.volume = 0.75
    }

    return () => {
      if (warningAlarmAudioRef.current) {
        warningAlarmAudioRef.current.pause()
      }
      if (criticalAlarmAudioRef.current) {
        criticalAlarmAudioRef.current.pause()
      }
    }
  }, [])

  useEffect(() => {
    const warningAudio = warningAlarmAudioRef.current
    const criticalAudio = criticalAlarmAudioRef.current
    if (!warningAudio || !criticalAudio) {
      return
    }

    const stopAudio = (audio: HTMLAudioElement) => {
      audio.pause()
      audio.currentTime = 0
    }

    if (alarmsSuppressed || baseAlarmLevel === 'normal') {
      stopAudio(warningAudio)
      stopAudio(criticalAudio)
      return
    }

    if (baseAlarmLevel === 'critical') {
      stopAudio(warningAudio)
      criticalAudio.play().catch(() => {})
      return
    }

    stopAudio(criticalAudio)
    warningAudio.play().catch(() => {})
  }, [alarmsSuppressed, baseAlarmLevel])

  const acknowledgeActiveAlarms = () => {
    if (!hasActiveAlarm) {
      return
    }

    setSilencedAlarmSignature(alarmSignature)
    setAlarmsPausedUntil(null)
  }

  const pauseAlarmsForTwoMinutes = () => {
    setAlarmsPausedUntil(Date.now() + 2 * 60 * 1000)
  }

  return (
    <section className="x3-monitor-shell">
      <div className="x3-topbar">
        <div className="x3-topbar-left">
          <span className="x3-person-icon">â—”</span>
          <span>Not Admitted</span>
        </div>
        <div className={`x3-topbar-center ${x3TopbarState}`.trim()}>{x3TopbarText}</div>
        <div className="x3-topbar-right">
          <span className="x3-battery-icon">▱▱▱</span>
          <span>{clockDisplay}</span>
        </div>
      </div>

      <div className="x3-body">
        <aside className="x3-sidebar" aria-label="X3 side menu">
          <button type="button" className={`x3-sidekey ${alarmsSilenced ? 'active' : ''}`.trim()} onClick={acknowledgeActiveAlarms}>
            <span className="x3-sidekey-icon">△∿</span>
            <span>Tyst</span>
          </button>
          <button type="button" className="x3-sidekey active">
            <span className="x3-sidekey-icon">▣</span>
            <span>Screen</span>
          </button>
          <button type="button" className={`x3-sidekey ${alarmsPaused ? 'active' : ''}`.trim()} onClick={pauseAlarmsForTwoMinutes}>
            <span className="x3-sidekey-icon">▦</span>
            <span>{alarmsPaused ? pauseMinSec : 'Paus 2m'}</span>
          </button>
        </aside>

        <div className="x3-main">
          <div className="x3-row ecg">
            <div className="x3-wave-area">
              <div className="x3-wave-meta">
                <span className="x3-channel">II</span>
                <span className="x3-scale">1mV</span>
                <span className="x3-rhythm-label">Sinus Rhythm</span>
              </div>
              <Waveform rhythm={state.rhythm} alarmLevel={x3AlarmLevel} compact variant="ecg" rate={state.vitals.hr} flatline={!showHr} />
            </div>
            <div className={`x3-metric x3-metric-green ${hrWarning && !alarmsSuppressed ? 'warning' : ''} ${hrCritical && !alarmsSuppressed ? 'critical' : ''}`.trim()}>
              <div className="x3-metric-head">
                <span>HR</span>
                <div className="x3-limits">
                  <span>{hrHighLimit}</span>
                  <span>{hrLowLimit}</span>
                </div>
              </div>
              <div className="x3-metric-big">{showHr ? state.vitals.hr : '—'}</div>
            </div>
          </div>

          <div className="x3-row pleth">
            <div className="x3-wave-area">
              <div className="x3-wave-meta">
                <span className="x3-channel">Pleth</span>
              </div>
              <Waveform rhythm={state.rhythm} alarmLevel={x3AlarmLevel} compact variant="pleth" rate={state.vitals.hr} flatline={!showSpo2} />
            </div>
            <div className={`x3-metric x3-metric-cyan ${spo2Warning && !alarmsSuppressed ? 'warning' : ''} ${spo2Critical && !alarmsSuppressed ? 'critical' : ''}`.trim()}>
              <div className="x3-metric-head">
                <span>SpOâ‚‚</span>
                <div className="x3-limits">
                  <span>100</span>
                  <span>{spo2LowLimit}</span>
                </div>
              </div>
              <div className="x3-metric-big">{showSpo2 ? state.vitals.spo2 : '—'}</div>
            </div>
          </div>

          <div className="x3-row resp">
            <div className="x3-wave-area">
              <div className="x3-wave-meta">
                <span className="x3-channel">Resp</span>
                <span className="x3-scale">{`${x3RespPerMin}/min`}</span>
              </div>
              {/* Waveform rendered at Philips-standard 6.25 mm/s paper speed */}
              <Waveform rhythm={state.rhythm} alarmLevel={x3AlarmLevel} compact variant="resp" rate={state.vitals.rr} flatline={!showResp} visibleSecondsOverride={10} />
            </div>
            <div className="x3-metric x3-metric-yellow">
              <div className="x3-metric-head">
                <span>RR</span>
                <div className="x3-limits">
                  <span>30</span>
                  <span>8</span>
                </div>
              </div>
              <div className="x3-metric-big">{showResp ? state.vitals.rr : '—'}</div>
            </div>
          </div>

          <div className="x3-bottom">
            <div className={`x3-nbp-panel ${nibpWarning && !alarmsSuppressed ? 'warning' : ''} ${nibpCritical && !alarmsSuppressed ? 'critical' : ''}`.trim()}>
              <div className="x3-nbp-header">
                <span>NBP</span>
                <span>{x3NbpModeLabel}</span>
              </div>
              <div className="x3-nbp-body">
                <div className="x3-nbp-labels">
                  <span>Sys.</span>
                  <span>{nibpSysHighLimit}</span>
                  <span>{nibpSysLowLimit}</span>
                </div>
                <div className="x3-nbp-reading">{showAbp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia}` : '—/—'} {showAbp ? `(${state.vitals.map})` : ''}</div>
              </div>
            </div>

            <div className="x3-side-metrics">
              <div className="x3-pulse-box">
                <span className="x3-side-title">Pulse</span>
                <strong>{showHr ? state.vitals.hr : '—'}</strong>
              </div>
              <div className="x3-st-box">
                <div><span>ST-I</span><strong>0.1</strong></div>
                <div><span>ST-II</span><strong>0.2</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const Corpuls3Screen = ({
  state,
  triggerNibpReading,
  setRhythm,
  setAlarmLevel,
}: {
  state: SimulationState
  triggerNibpReading?: () => void
  setRhythm?: (rhythm: RhythmPreset) => void
  setAlarmLevel?: (alarmLevel: AlarmLevel) => void
}) => {
  const monitorViews = ['main', 'trend', 'lt-ecg', 'd-ecg'] as const
  const parameterFields = ['HR', 'SpO2', 'CO2', 'RR', 'NIBP'] as const
  const curveFields = ['ECG I', 'Pleth', 'CO2', 'P3'] as const
  const parameterMenuItems = ['Assign', 'Alarm', 'Limits'] as const
  const curveMenuItems = ['Lead', 'Ampl', 'Speed'] as const
  const mainMenuItems = ['Defib', 'Monitor', 'System', 'Printer'] as const
  const configItems = ['Colours', 'Night', 'QRS', 'Metronome', 'Timeline', 'Zoom'] as const
  const [now, setNow] = useState(() => new Date())
  const [mode, setMode] = useState<'monitor' | 'aed' | 'manual' | 'pacer' | 'browser'>('monitor')
  const [deviceOn, setDeviceOn] = useState(true)
  const [energy, setEnergy] = useState(150)
  const [analysisState, setAnalysisState] = useState<'idle' | 'running' | 'done'>('idle')
  const [chargeState, setChargeState] = useState<'idle' | 'charging' | 'ready'>('idle')
  const [stopwatchSeconds, setStopwatchSeconds] = useState(0)
  const [dialAngle, setDialAngle] = useState(0)
  const [dialPressed, setDialPressed] = useState(false)
  const [pacerProgram, setPacerProgram] = useState<'fix' | 'demand' | 'overdrive'>('demand')
  const [pacerRate, setPacerRate] = useState(70)
  const [pacerCurrent, setPacerCurrent] = useState(40)
  const [pacerActive, setPacerActive] = useState(false)
  const [monitorView, setMonitorView] = useState<(typeof monitorViews)[number]>('main')
  const [pacerDialTarget, setPacerDialTarget] = useState<'rate' | 'current'>('rate')
  const [softkeyFocus, setSoftkeyFocus] = useState(0)
  const [fieldCursor, setFieldCursor] = useState(0)
  const [dialContext, setDialContext] = useState<'fields' | 'parameter-menu' | 'curve-menu' | 'main-menu' | 'config'>('fields')
  const [menuIndex, setMenuIndex] = useState(0)
  const [configIndex, setConfigIndex] = useState(0)
  const [configEditing, setConfigEditing] = useState(false)
  const [configParent, setConfigParent] = useState<'parameter-menu' | 'curve-menu' | 'main-menu'>('main-menu')
  const [manualDialEnabled, setManualDialEnabled] = useState(true)
  const [qrsVolume, setQrsVolume] = useState(0)
  const [metronomeVolume, setMetronomeVolume] = useState(2)
  const [timelinePosition, setTimelinePosition] = useState(0)
  const [ltEcgZoom, setLtEcgZoom] = useState(1)
  const [nightView, setNightView] = useState(false)
  const [invertedColors, setInvertedColors] = useState(false)
  const [dialRotating, setDialRotating] = useState(false)
  const [browserHoldStart, setBrowserHoldStart] = useState(0)
  const [alarmHistoryVisible, setAlarmHistoryVisible] = useState(false)
  const [alarmHistory] = useState<Array<{ time: Date; message: string }>>([
    { time: new Date(Date.now() - 5000), message: 'Asystole detected' },
    { time: new Date(Date.now() - 8000), message: 'Low SpO2' },
  ])
  const [alarmHistoryIndex, setAlarmHistoryIndex] = useState(0)
  const [eventListVisible, setEventListVisible] = useState(false)
  const [eventHistory, setEventHistory] = useState<Array<{ time: Date; label: string }>>([])
  const [keyboardLocked, setKeyboardLocked] = useState(false)
  const [homeKeyHoldStart, setHomeKeyHoldStart] = useState(0)
  const [monitorKeyHoldStart, setMonitorKeyHoldStart] = useState(0)
  const [alarmKeyHoldStart, setAlarmKeyHoldStart] = useState(0)
  const [eventKeyHoldStart, setEventKeyHoldStart] = useState(0)
  const [printRunning, setPrintRunning] = useState(false)
  const [logPrinting, setLogPrinting] = useState(false)
  const dialRef = useRef<HTMLDivElement | null>(null)
  const dialStepRef = useRef<number | null>(null)
  const dialMovedRef = useRef(false)
  const dialTurnIntentRef = useRef(false)
  const dialStartAngleRef = useRef(0)
  const dialPointerIdRef = useRef<number | null>(null)
  const dialRotateTimerRef = useRef<number | null>(null)
  const dialPressStartRef = useRef(0)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setStopwatchSeconds((prev) => prev + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (analysisState !== 'running') {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setAnalysisState('done')
      const isShockable = state.rhythm === 'vfib' || state.rhythm === 'vtach'
      if (isShockable) {
        setChargeState('ready')
        setAlarmLevel?.('critical')
      }
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [analysisState, setAlarmLevel, state.rhythm])

  useEffect(() => {
    if (chargeState !== 'charging') {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setChargeState('ready')
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [chargeState])

  useEffect(() => () => {
    if (dialRotateTimerRef.current !== null) {
      window.clearTimeout(dialRotateTimerRef.current)
    }
  }, [])

  const { parameterVisibility } = state
  const hideSpo2Value = state.vitals.nibpSys < 60
  const hideEtco2Value = state.vitals.nibpSys < 40
  const showHr = parameterVisibility.hr
  const showSpo2 = parameterVisibility.spo2 && !hideSpo2Value
  const showResp = parameterVisibility.rr
  const showEtco2 = parameterVisibility.etco2 && !hideEtco2Value
  const showAbp = parameterVisibility.abp
  const nibpValue = state.nibpReading ? `${state.nibpReading.sys}/${state.nibpReading.dia}` : '—/—'
  const nibpValueWithMap = state.nibpReading ? `${state.nibpReading.sys}/${state.nibpReading.dia} (${state.nibpReading.map})` : '—/—'
  const dEcgLeadsLeft = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'] as const
  const dEcgLeadsRight = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const
  const energySteps = [50, 100, 150, 200]
  const totalFields = parameterFields.length + curveFields.length
  const activeFieldType = fieldCursor < parameterFields.length ? 'parameter' : 'curve'
  const activeFieldLabel = activeFieldType === 'parameter'
    ? parameterFields[fieldCursor]
    : curveFields[fieldCursor - parameterFields.length]
  const isFieldSelecting = dialContext === 'fields' && (mode === 'monitor' || mode === 'browser')
  const activeMenuItems = dialContext === 'parameter-menu'
    ? parameterMenuItems
    : dialContext === 'curve-menu'
      ? curveMenuItems
      : mainMenuItems

  const controlsLocked = keyboardLocked || !deviceOn

  const canUseControls = () => !controlsLocked

  const getDialAngleAtPoint = (clientX: number, clientY: number): number | null => {
    const dialElement = dialRef.current
    if (!dialElement) {
      return null
    }

    const rect = dialElement.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    return Math.atan2(clientY - centerY, clientX - centerX)
  }

  const normalizeAngleDelta = (delta: number): number => {
    let normalized = delta
    while (normalized > Math.PI) {
      normalized -= Math.PI * 2
    }
    while (normalized < -Math.PI) {
      normalized += Math.PI * 2
    }
    return normalized
  }

  const rotateDialVisual = (direction: 1 | -1, steps = 1) => {
    setDialAngle((prev) => prev + direction * 16 * steps)
    setDialRotating(true)
    if (dialRotateTimerRef.current !== null) {
      window.clearTimeout(dialRotateTimerRef.current)
    }
    dialRotateTimerRef.current = window.setTimeout(() => setDialRotating(false), 140)
  }

  const formatStopwatch = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(1, '0')
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  const stepEnergy = (direction: 1 | -1) => {
    if (mode === 'manual' && !manualDialEnabled) {
      rotateDialVisual(direction)
      return
    }

    const currentIndex = energySteps.indexOf(energy)
    const fallbackIndex = energySteps.findIndex((step) => step > energy)
    const safeIndex = currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0)
    const nextIndex = direction > 0
      ? Math.min(safeIndex + 1, energySteps.length - 1)
      : Math.max(safeIndex - 1, 0)
    setEnergy(energySteps[nextIndex])
    rotateDialVisual(direction)
  }

  const stepPacer = (direction: 1 | -1) => {
    if (pacerDialTarget === 'rate') {
      const step = pacerProgram === 'overdrive' ? 10 : 5
      setPacerRate((prev) => clamp(prev + direction * step, 30, 300))
    } else {
      setPacerCurrent((prev) => clamp(prev + direction * 5, 10, 200))
    }
    rotateDialVisual(direction)
  }

  const stepFieldCursor = (direction: 1 | -1) => {
    setFieldCursor((prev) => (prev + direction + totalFields) % totalFields)
    rotateDialVisual(direction)
  }

  const stepMenuIndex = (direction: 1 | -1) => {
    const length = activeMenuItems.length
    setMenuIndex((prev) => (prev + direction + length) % length)
    rotateDialVisual(direction)
  }

  const applyConfigChange = (direction: 1 | -1) => {
    switch (configIndex) {
      case 0:
        setInvertedColors((prev) => (direction > 0 ? !prev : !prev))
        break
      case 1:
        setNightView((prev) => (direction > 0 ? !prev : !prev))
        break
      case 2:
        setQrsVolume((prev) => clamp(prev + direction, 0, 10))
        break
      case 3:
        setMetronomeVolume((prev) => clamp(prev + direction, 0, 10))
        break
      case 4:
        setTimelinePosition((prev) => clamp(prev + direction * 5, 0, 100))
        break
      case 5:
        setLtEcgZoom((prev) => clamp(prev + direction, 1, 10))
        break
      default:
        break
    }
    rotateDialVisual(direction)
  }

  const runSoftkeyAction = (index: number) => {
    if (!canUseControls()) {
      return
    }

    switch (index) {
      case 0:
        setQrsVolume((prev) => (prev >= 10 ? 0 : prev + 1))
        break
      case 1: {
        const currentIndex = monitorViews.indexOf(monitorView)
        const safeIndex = currentIndex >= 0 ? currentIndex : 0
        const next = (safeIndex + 1) % monitorViews.length
        setMonitorView(monitorViews[next])
        break
      }
      case 2:
        setMonitorView('trend')
        break
      case 3:
        setMonitorView('lt-ecg')
        break
      case 4:
        setMonitorView('d-ecg')
        break
      case 5:
        triggerNibpReading?.()
        break
      default:
        break
    }
  }

  const handleDialTurn = (direction: 1 | -1) => {
    if (!canUseControls()) {
      return
    }

    if (dialContext === 'main-menu' || dialContext === 'parameter-menu' || dialContext === 'curve-menu') {
      stepMenuIndex(direction)
      return
    }

    if (dialContext === 'config') {
      if (configEditing) {
        applyConfigChange(direction)
      } else {
        setConfigIndex((prev) => (prev + direction + configItems.length) % configItems.length)
        rotateDialVisual(direction)
      }
      return
    }

    if (mode === 'pacer') {
      stepPacer(direction)
      return
    }

    if (monitorView === 'lt-ecg') {
      setTimelinePosition((prev) => clamp(prev + direction * 2, 0, 100))
      rotateDialVisual(direction)
      return
    }

    if (mode === 'monitor' || mode === 'browser') {
      stepFieldCursor(direction)
      return
    }

    stepEnergy(direction)
  }

  const handleDialPress = (durationMs: number) => {
    if (!canUseControls()) {
      return
    }

    if (dialContext === 'config') {
      if (configEditing) {
        setConfigEditing(false)
      } else {
        setConfigEditing(true)
      }
      return
    }

    if (dialContext === 'main-menu' || dialContext === 'parameter-menu' || dialContext === 'curve-menu') {
      setConfigParent(dialContext === 'main-menu' ? 'main-menu' : dialContext)
      setDialContext('config')
      setConfigEditing(false)
      setConfigIndex(0)
      return
    }

    if (mode === 'pacer') {
      if (durationMs >= 450) {
        setPacerActive((prev) => !prev)
      } else {
        setPacerDialTarget((prev) => (prev === 'rate' ? 'current' : 'rate'))
      }
      return
    }

    if (mode === 'manual') {
      // IFU: pressing jog dial in manual mode blocks dial energy selection until Manual is pressed again.
      setManualDialEnabled(false)
      return
    }

    if (mode === 'monitor' || mode === 'browser') {
      if (durationMs >= 450) {
        setDialContext('main-menu')
        setMenuIndex(0)
        return
      }

      if (activeFieldType === 'parameter') {
        setDialContext('parameter-menu')
      } else {
        setDialContext('curve-menu')
      }
      setMenuIndex(0)
      return
    }

    startCharge()
  }

  const runAnalysis = () => {
    if (!canUseControls()) {
      return
    }

    // IFU: Analyse key selects AED mode or starts analysis if already in AED.
    if (mode === 'pacer') {
      return
    }

    if (mode !== 'aed') {
      setMode('aed')
      setDialContext('fields')
      setChargeState('idle')
      setAnalysisState('idle')
      return
    }

    // Already in AED mode: start analysis
    setAnalysisState('running')
  }

  const startCharge = () => {
    if (!canUseControls()) {
      return
    }

    // IFU: Charge key selects manual mode or initiates charging.
    if (mode === 'pacer') {
      setPacerProgram((prev) => prev === 'fix' ? 'demand' : prev === 'demand' ? 'overdrive' : 'fix')
      return
    }

    if (mode !== 'manual' && mode !== 'aed') {
      setMode('manual')
      setDialContext('fields')
      setManualDialEnabled(true)
      setChargeState('idle')
      return
    }

    if (chargeState === 'charging') {
      return
    }

    // In manual or AED: start charging
    setAnalysisState('idle')
    setChargeState('charging')
  }

  const enterAedMode = () => {
    if (!canUseControls()) {
      return
    }

    // IFU: AED key selects automated external defibrillation mode.
    setMode('aed')
    setDialContext('fields')
    setChargeState('idle')
    setAnalysisState('idle')
  }

  const deliverShock = () => {
    if (!deviceOn) {
      return
    }

    if (mode === 'pacer') {
      setPacerActive((prev) => !prev)
      return
    }

    if (chargeState !== 'ready') {
      return
    }

    if (state.rhythm === 'vfib' || state.rhythm === 'vtach') {
      setRhythm?.('sinus')
      setAlarmLevel?.('normal')
    } else {
      setAlarmLevel?.('warning')
    }

    setChargeState('idle')
    setAnalysisState('idle')
    setMode('monitor')
  }

  const onDialWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!canUseControls()) {
      return
    }
    handleDialTurn(event.deltaY > 0 ? -1 : 1)
  }

  const updateDialFromPoint = (clientX: number, clientY: number) => {
    const angle = getDialAngleAtPoint(clientX, clientY)
    if (angle === null) {
      return
    }

    const intentDelta = Math.abs(normalizeAngleDelta(angle - dialStartAngleRef.current))
    if (intentDelta > 0.1) {
      dialTurnIntentRef.current = true
    }

    const totalSteps = 32
    const step = Math.round((angle / (Math.PI * 2)) * totalSteps)

    if (dialStepRef.current === null) {
      dialStepRef.current = step
      return
    }

    let delta = step - dialStepRef.current
    if (delta > totalSteps / 2) {
      delta -= totalSteps
    } else if (delta < -totalSteps / 2) {
      delta += totalSteps
    }

    if (delta >= 1) {
      dialMovedRef.current = true
      dialTurnIntentRef.current = true
      for (let i = 0; i < delta; i += 1) {
        handleDialTurn(1)
      }
    }

    if (delta <= -1) {
      dialMovedRef.current = true
      dialTurnIntentRef.current = true
      for (let i = 0; i < Math.abs(delta); i += 1) {
        handleDialTurn(-1)
      }
    }

    dialStepRef.current = step
  }

  const onDialPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canUseControls()) {
      return
    }

    setDialPressed(true)
    dialMovedRef.current = false
    dialTurnIntentRef.current = false
    dialStepRef.current = null
    dialPointerIdRef.current = event.pointerId
    dialPressStartRef.current = Date.now()

    const startAngle = getDialAngleAtPoint(event.clientX, event.clientY)
    if (startAngle !== null) {
      dialStartAngleRef.current = startAngle
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    updateDialFromPoint(event.clientX, event.clientY)
  }

  const onDialPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dialPressed || dialPointerIdRef.current !== event.pointerId) {
      return
    }
    updateDialFromPoint(event.clientX, event.clientY)
  }

  const onDialPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dialPressed || dialPointerIdRef.current !== event.pointerId) {
      return
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDialPressed(false)
    dialPointerIdRef.current = null
    dialStepRef.current = null

    if (!dialMovedRef.current && !dialTurnIntentRef.current) {
      handleDialPress(Date.now() - dialPressStartRef.current)
    }
  }

  const onDialPointerCancel = () => {
    setDialPressed(false)
    dialPointerIdRef.current = null
    dialStepRef.current = null
  }

  const onBackKey = () => {
    if (!canUseControls()) {
      return
    }

    // IFU: Back key returns to next menu level up or undoes last selection.
    if (dialContext === 'config') {
      setConfigEditing(false)
      setDialContext(configParent)
      return
    }

    if (dialContext === 'main-menu' || dialContext === 'parameter-menu' || dialContext === 'curve-menu') {
      setDialContext('fields')
      return
    }

    // Return to monitor mode if not there already
    if (mode !== 'monitor') {
      setMode('monitor')
      setDialContext('fields')
    }
  }

  const runHomeKeyAction = () => {
    if (!deviceOn || keyboardLocked) {
      return
    }

    // IFU: Home key switches to basic status of respective mode and leaves menus completely.
    setDialContext('fields')
    setConfigEditing(false)
    setMenuIndex(0)
    setFieldCursor(0)
    setMonitorView('main')
    // Stay in current mode but return to field view
    if (mode !== 'monitor' && mode !== 'pacer' && mode !== 'browser') {
      setMode('monitor')
    }
  }

  const onBrowserKey = (holdDuration: number) => {
    if (!canUseControls()) {
      return
    }

    // IFU: Browser key starts printing of log. If held >3s, mission browser opens.
    if (holdDuration >= 3000) {
      setMode('browser')
      setDialContext('fields')
      setLogPrinting(false)
    } else {
      // Toggle log print job
      setLogPrinting((prev) => !prev)
    }
  }

  const onBrowserKeyDown = () => {
    setBrowserHoldStart(Date.now())
  }

  const onBrowserKeyUp = () => {
    const holdDuration = Date.now() - browserHoldStart
    onBrowserKey(holdDuration)
    setBrowserHoldStart(0)
  }

  const onPrintKey = () => {
    if (!canUseControls()) {
      return
    }

    // IFU: Print key starts real-time printout of curves. Press again to interrupt.
    setPrintRunning((prev) => !prev)
  }

  const onPowerKey = () => {
    setDeviceOn((prev) => {
      if (prev) {
        setKeyboardLocked(false)
        setDialContext('fields')
        setAnalysisState('idle')
        setChargeState('idle')
        setPacerActive(false)
        setPrintRunning(false)
        setLogPrinting(false)
      }
      return !prev
    })

    if (!deviceOn) {
      setMode('monitor')
      setMonitorView('main')
    }
  }

  const openFieldMenu = (fieldIndex: number) => {
    if (!canUseControls()) {
      return
    }

    if (mode !== 'monitor' && mode !== 'browser') {
      return
    }

    setFieldCursor(fieldIndex)
    setMenuIndex(0)
    if (fieldIndex < parameterFields.length) {
      setDialContext('parameter-menu')
      return
    }

    setDialContext('curve-menu')
  }

  const onMonitorKeyDown = () => {
    setMonitorKeyHoldStart(Date.now())
  }

  const onMonitorKeyUp = () => {
    if (monitorKeyHoldStart === 0) {
      return
    }

    if (!deviceOn || keyboardLocked) {
      setMonitorKeyHoldStart(0)
      return
    }

    const holdDuration = Date.now() - monitorKeyHoldStart
    if (holdDuration >= 3000) {
      // IFU: Monitor key held >3s inverts screen colors
      setInvertedColors((prev) => !prev)
    } else {
      // Brief press: select monitoring mode
      setMode('monitor')
      setDialContext('fields')
      setPacerActive(false)
    }
    setMonitorKeyHoldStart(0)
  }

  const onAlarmKeyDown = () => {
    setAlarmKeyHoldStart(Date.now())
  }

  const onAlarmKeyUp = () => {
    if (alarmKeyHoldStart === 0) {
      return
    }

    if (!canUseControls()) {
      setAlarmKeyHoldStart(0)
      return
    }

    const holdDuration = Date.now() - alarmKeyHoldStart
    if (holdDuration >= 3000) {
      // IFU: Alarm key held ~3s suspends physiological alarms
      setAlarmHistoryVisible(false)
    } else {
      // Brief press: show/cycle alarm history
      if (!alarmHistoryVisible) {
        setAlarmHistoryIndex(0)
        setAlarmHistoryVisible(true)
      } else {
        // Confirm alarm and move to next
        if (alarmHistoryIndex < alarmHistory.length - 1) {
          setAlarmHistoryIndex((prev) => prev + 1)
        } else {
          setAlarmHistoryVisible(false)
        }
      }
    }
    setAlarmKeyHoldStart(0)
  }

  const onEventKeyDown = () => {
    setEventKeyHoldStart(Date.now())
  }

  const onEventKeyUp = () => {
    if (eventKeyHoldStart === 0) {
      return
    }

    if (!canUseControls()) {
      setEventKeyHoldStart(0)
      return
    }

    const holdDuration = Date.now() - eventKeyHoldStart
    if (holdDuration >= 3000) {
      // IFU: Event key held >3s shows event list
      setEventListVisible(true)
    } else {
      // Brief press: save event timestamp
      const newEvent = { time: new Date(), label: 'Event recorded' }
      setEventHistory((prev) => [newEvent, ...prev])
    }
    setEventKeyHoldStart(0)
  }

  const onHomeKeyDown = () => {
    if (!deviceOn) {
      return
    }
    setHomeKeyHoldStart(Date.now())
  }

  const onHomeKeyUp = () => {
    if (!deviceOn || homeKeyHoldStart === 0) {
      return
    }

    const holdDuration = Date.now() - homeKeyHoldStart
    if (holdDuration >= 1200) {
      setKeyboardLocked((prev) => !prev)
    } else {
      runHomeKeyAction()
    }
    setHomeKeyHoldStart(0)
  }

  const onManualEnergyKey = () => {
    if (!canUseControls()) {
      return
    }

    if (mode === 'pacer') {
      setPacerDialTarget((prev) => (prev === 'rate' ? 'current' : 'rate'))
      return
    }

    if (mode !== 'manual') {
      setMode('manual')
      setDialContext('fields')
      setManualDialEnabled(true)
      return
    }

    if (!manualDialEnabled) {
      setManualDialEnabled(true)
      return
    }

    stepEnergy(1)
  }

  const onDialKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canUseControls()) {
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      handleDialTurn(-1)
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      handleDialTurn(1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleDialPress(0)
    }
  }

  const statusDetail = !deviceOn
    ? 'Power Off'
    : keyboardLocked
      ? 'Keyboard locked'
      : analysisState === 'running'
        ? 'Analysing'
        : chargeState === 'charging'
          ? 'Charging'
          : chargeState === 'ready'
            ? 'Ready'
            : mode === 'pacer'
              ? `Pacer ${pacerProgram.toUpperCase()} ${pacerRate}/min ${pacerCurrent}mA ${pacerDialTarget === 'rate' ? 'SEL RATE' : 'SEL mA'} ${pacerActive ? 'ON' : 'OFF'}`
              : dialContext === 'config'
                ? `Cfg ${configItems[configIndex]} ${configEditing ? 'EDIT' : 'SELECT'} QRS:${qrsVolume} MET:${metronomeVolume}`
                : dialContext === 'main-menu'
                  ? `Main menu ${mainMenuItems[menuIndex]}`
                  : dialContext === 'parameter-menu'
                    ? `Param ${activeFieldLabel} ${parameterMenuItems[menuIndex]}`
                    : dialContext === 'curve-menu'
                      ? `Curve ${activeFieldLabel} ${curveMenuItems[menuIndex]}`
              : printRunning
                ? 'Print running'
                : logPrinting
                  ? 'Log printing'
                  : mode === 'browser'
                    ? `Browser ${activeFieldType === 'parameter' ? 'P' : 'C'}:${activeFieldLabel} ${invertedColors ? 'INV' : 'STD'}`
                    : mode === 'aed'
                      ? 'AED'
                      : mode === 'manual'
                        ? `Manual ${manualDialEnabled ? `${energy}J` : 'SOFTKEY ONLY'}`
                        : `Monitor ${activeFieldType === 'parameter' ? 'P' : 'C'}:${activeFieldLabel} ${nightView ? 'NIGHT' : 'DAY'}`

    const isContextMenuVisible =
      dialContext === 'parameter-menu'
      || dialContext === 'curve-menu'
      || dialContext === 'main-menu'
      || dialContext === 'config'

    const contextMenuTitle =
      dialContext === 'parameter-menu'
        ? `Param ${activeFieldLabel}`
        : dialContext === 'curve-menu'
          ? `Curve ${activeFieldLabel}`
          : dialContext === 'main-menu'
            ? 'Main menu'
            : 'Config'

    const contextMenuItems =
      dialContext === 'parameter-menu'
        ? [...parameterMenuItems]
        : dialContext === 'curve-menu'
          ? [...curveMenuItems]
          : dialContext === 'main-menu'
            ? [...mainMenuItems]
            : [...configItems]

    const contextMenuIndex = dialContext === 'config' ? configIndex : menuIndex

      const trendRows = [
        {
          label: 'HR',
          value: showHr ? `${state.vitals.hr} bpm` : '—',
          ratio: clamp(state.vitals.hr / 200, 0, 1),
        },
        {
          label: 'SpO2',
          value: showSpo2 ? `${state.vitals.spo2} %` : '—',
          ratio: clamp(state.vitals.spo2 / 100, 0, 1),
        },
        {
          label: 'RR',
          value: showResp ? `${state.vitals.rr} /min` : '—',
          ratio: clamp(state.vitals.rr / 45, 0, 1),
        },
        {
          label: 'ABP',
          value: showAbp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia} (${state.vitals.map})` : '—/—',
          ratio: clamp(state.vitals.map / 140, 0, 1),
        },
        {
          label: 'NIBP',
          value: nibpValueWithMap,
          ratio: state.nibpReading ? clamp(state.nibpReading.map / 140, 0, 1) : 0,
        },
      ]

  return (
    <section className="corpuls3-device" aria-label="Defib monitor">
      <div className="corpuls3-top-cap" aria-hidden="true" />

      <div className="corpuls3-body">
        <div className={`corpuls3-display ${deviceOn ? '' : 'device-off'}`.trim()}>
          <div className="corpuls3-tab-row" aria-hidden="true">
            <button type="button">🔔</button>
            <button type="button">â†—</button>
          </div>

          <div className="corpuls3-toolbar">
            <span>ID Pat. n/b</span>
            <span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="corpuls3-brand">corpulsÂ³</span>
          </div>

          {monitorView === 'd-ecg' ? (
            <div className="corpuls3-d-ecg-topbar" aria-label="D-ECG metrics">
              <span className="corpuls3-d-ecg-patient">Doe</span>
              <div className="corpuls3-d-ecg-param hr">
                <span>HR</span>
                <strong>{showHr ? state.vitals.hr : '—'}</strong>
                <small>1/min</small>
              </div>
              <div className="corpuls3-d-ecg-param spo2">
                <span>SpO2</span>
                <strong>{showSpo2 ? state.vitals.spo2 : '—'}</strong>
                <small>%</small>
              </div>
              <div className="corpuls3-d-ecg-param nibp">
                <span>NIBP</span>
                <strong>{state.nibpReading ? `${state.nibpReading.sys}/${state.nibpReading.dia}` : '—/—'}</strong>
                <small>{state.nibpReading ? `(${state.nibpReading.map})` : ''}</small>
              </div>
              <div className="corpuls3-d-ecg-param co2">
                <span>CO2</span>
                <strong>{showEtco2 ? state.vitals.etco2 : '—'}</strong>
                <small>mmHg</small>
              </div>
              <div className="corpuls3-d-ecg-param time">
                <span>â±</span>
                <strong>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
              </div>
            </div>
          ) : (
            <div className="corpuls3-vitals-row">
              <div
                className={`corpuls3-vital hr ${isFieldSelecting && fieldCursor === 0 ? 'selected' : ''}`.trim()}
                onClick={() => openFieldMenu(0)}
              >
                <span className="label">HR</span>
                <span className="value">{showHr ? state.vitals.hr : '—'}</span>
              </div>
              <div
                className={`corpuls3-vital spo2 ${isFieldSelecting && fieldCursor === 1 ? 'selected' : ''}`.trim()}
                onClick={() => openFieldMenu(1)}
              >
                <span className="label">SpO2</span>
                <span className="value">{showSpo2 ? state.vitals.spo2 : '—'}</span>
              </div>
              <div
                className={`corpuls3-vital co2 ${isFieldSelecting && fieldCursor === 2 ? 'selected' : ''}`.trim()}
                onClick={() => openFieldMenu(2)}
              >
                <span className="label">CO2</span>
                <span className="value">{showEtco2 ? formatEtco2Kpa(state.vitals.etco2) : '—'}</span>
              </div>
              <div
                className={`corpuls3-vital rr ${isFieldSelecting && fieldCursor === 3 ? 'selected' : ''}`.trim()}
                onClick={() => openFieldMenu(3)}
              >
                <span className="label">RR</span>
                <span className="value">{showResp ? state.vitals.rr : '—'}</span>
              </div>
              <div
                className={`corpuls3-vital nibp ${isFieldSelecting && fieldCursor === 4 ? 'selected' : ''}`.trim()}
                onClick={() => openFieldMenu(4)}
              >
                <span className="label">NIBP</span>
                <span className="value">{nibpValue}</span>
              </div>
            </div>
          )}

          <div className="corpuls3-monitor-surface">
            {monitorView === 'main' ? (
              <>
                <div className="corpuls3-wave-grid">
                  <div
                    className={`corpuls3-trace ecg ${isFieldSelecting && fieldCursor === 5 ? 'selected' : ''}`.trim()}
                    onClick={() => openFieldMenu(5)}
                  >
                    <span className="trace-label">I</span>
                    <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="ecg" rate={state.vitals.hr} flatline={!showHr} />
                  </div>

                  <div
                    className={`corpuls3-trace pleth ${isFieldSelecting && fieldCursor === 6 ? 'selected' : ''}`.trim()}
                    onClick={() => openFieldMenu(6)}
                  >
                    <span className="trace-label">Pleth</span>
                    <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="pleth" rate={state.vitals.hr} flatline={!showSpo2} />
                  </div>

                  <div
                    className={`corpuls3-trace co2 ${isFieldSelecting && fieldCursor === 7 ? 'selected' : ''}`.trim()}
                    onClick={() => openFieldMenu(7)}
                  >
                    <span className="trace-label">CO2</span>
                    <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="etco2" rate={state.vitals.hr} flatline={!showEtco2} />
                  </div>

                  <div
                    className={`corpuls3-trace p3 ${isFieldSelecting && fieldCursor === 8 ? 'selected' : ''}`.trim()}
                    onClick={() => openFieldMenu(8)}
                  >
                    <span className="trace-label">P3 (IBP)</span>
                    <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="abp" rate={state.vitals.hr} flatline={!showAbp} />
                  </div>
                </div>

                <aside className="corpuls3-side-values">
                  <div><span>NIBP</span><strong>{nibpValueWithMap}</strong></div>
                  <div><span>T1</span><strong>{parameterVisibility.temp ? formatTemp(state.vitals.temp) : '—'}</strong></div>
                  <div><span>P1 (AP)</span><strong>{statusDetail}</strong></div>
                  <div><span>P3 (IBP)</span><strong>{showAbp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia}` : '—/—'} {showAbp ? `(${state.vitals.map})` : ''}</strong></div>
                  <div><span>Time</span><strong>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong></div>
                  <div><span>Stopwatch</span><strong>{formatStopwatch(stopwatchSeconds)}</strong></div>
                </aside>
              </>
            ) : monitorView === 'trend' ? (
              <div className="corpuls3-view-panel trend" aria-label="Trend view">
                <div className="corpuls3-view-header">
                  <strong>Trend</strong>
                  <span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
                <div className="corpuls3-trend-list">
                  {trendRows.map((row) => (
                    <div key={row.label} className="corpuls3-trend-row">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                      <div className="corpuls3-trend-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round(row.ratio * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : monitorView === 'lt-ecg' ? (
              <div className="corpuls3-view-panel ecg-focus" aria-label="Long-term ECG view">
                <div className="corpuls3-view-header">
                  <strong>LT-ECG</strong>
                  <span>{`T ${timelinePosition}% | Z ${ltEcgZoom}`}</span>
                </div>
                <div className="corpuls3-ecg-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="ecg" rate={state.vitals.hr} flatline={!showHr} />
                </div>
                <div className="corpuls3-view-footer">
                  <span>HR {showHr ? `${state.vitals.hr} bpm` : '—'}</span>
                  <span>QRS {qrsVolume}/10</span>
                </div>
              </div>
            ) : (
              <div className="corpuls3-view-panel d-ecg" aria-label="Diagnostic ECG view">
                <div className="corpuls3-d-ecg-grid">
                  <div className="corpuls3-d-ecg-column">
                    {dEcgLeadsLeft.map((lead) => (
                      <div key={lead} className="corpuls3-d-ecg-lead">
                        <span>{lead}</span>
                        <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="ecg" lead={lead} rate={state.vitals.hr} flatline={!showHr} />
                      </div>
                    ))}
                  </div>
                  <div className="corpuls3-d-ecg-column">
                    {dEcgLeadsRight.map((lead) => (
                      <div key={lead} className="corpuls3-d-ecg-lead">
                        <span>{lead}</span>
                        <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="ecg" lead={lead} rate={state.vitals.hr} flatline={!showHr} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="corpuls3-d-ecg-footer">
                  <span>Ready for D-ECG</span>
                  <div className="corpuls3-d-ecg-actions" aria-hidden="true">
                    <span>Ampl+</span>
                    <span>Ampl-</span>
                    <span>0.05 Hz – 150 Hz</span>
                    <span className="active">Start</span>
                    <span>Cancel</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isContextMenuVisible && (
            <div className="corpuls3-context-menu" aria-label="Context menu">
              <p className="corpuls3-context-title">{contextMenuTitle}</p>
              <ul className="corpuls3-context-list">
                {contextMenuItems.map((item, index) => (
                  <li key={item} className={index === contextMenuIndex ? 'active' : ''}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="corpuls3-softkeys" aria-label="soft keys">
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 0 ? 'active' : ''} onClick={() => { setSoftkeyFocus(0); runSoftkeyAction(0) }}>QRS</button>
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 1 ? 'active' : ''} onClick={() => { setSoftkeyFocus(1); runSoftkeyAction(1) }}>Views</button>
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 2 ? 'active' : ''} onClick={() => { setSoftkeyFocus(2); runSoftkeyAction(2) }}>Trend</button>
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 3 ? 'active' : ''} onClick={() => { setSoftkeyFocus(3); runSoftkeyAction(3) }}>LT-ECG</button>
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 4 ? 'active' : ''} onClick={() => { setSoftkeyFocus(4); runSoftkeyAction(4) }}>D-ECG</button>
            <button type="button" disabled={!deviceOn} className={softkeyFocus === 5 ? 'active' : ''} onClick={() => { setSoftkeyFocus(5); runSoftkeyAction(5) }}>NIBP</button>
          </div>

          {!deviceOn ? <div className="corpuls3-power-off-screen">Power Off</div> : null}
        </div>

        <aside className="corpuls3-controls" aria-label="defibrillator controls">
          <div className="corpuls3-power-row">
            <button type="button" className="corpuls3-power-btn" onClick={onPowerKey} aria-label="Power">â»</button>
            <span
              className={`corpuls3-status-led ${chargeState === 'ready' ? 'ready' : chargeState === 'charging' ? 'charging' : ''}`.trim()}
              aria-hidden="true"
            />
          </div>

          <div className="corpuls3-action-grid">
            <button type="button" disabled={!deviceOn} className={`red ${mode === 'aed' ? 'active' : ''}`.trim()} onClick={enterAedMode} title="IFU: AED key selects automated external defibrillation mode">AED</button>
            <span className="numeric-mark" aria-hidden="true">1</span>
            <button type="button" disabled={!deviceOn} onClick={onManualEnergyKey} title="IFU: Manual key selects manual defibrillation mode or switches jog dial energy lock">{mode === 'pacer' ? 'Rate/mA' : 'Energy'}</button>
            <button type="button" disabled={!deviceOn} className={`red ${analysisState === 'running' ? 'active' : ''}`.trim()} onClick={runAnalysis} title="IFU: Analyse key selects AED or starts ECG analysis">Analyse</button>
            <span className="numeric-mark" aria-hidden="true">2</span>
            <button type="button" disabled={!deviceOn} className={chargeState === 'charging' ? 'active' : ''} onClick={startCharge} title="IFU: Charge key selects manual mode or initiates charging process">
              {mode === 'pacer' ? 'Program' : 'Charge'}
            </button>
          </div>

          <button type="button" className="corpuls3-shock-emblem" onClick={deliverShock} disabled={!deviceOn || chargeState !== 'ready'} title="IFU: Shock key triggers defibrillation in AED or manual mode">âš¡</button>

          <div
            ref={dialRef}
            className={`corpuls3-dial ${dialPressed ? 'pressed' : ''} ${dialRotating ? 'rotating' : ''}`.trim()}
            onWheel={onDialWheel}
            onPointerDown={onDialPointerDown}
            onPointerMove={onDialPointerMove}
            onPointerUp={onDialPointerUp}
            onPointerCancel={onDialPointerCancel}
            onKeyDown={onDialKeyDown}
            role="button"
            tabIndex={deviceOn ? 0 : -1}
            aria-label="Jog dial"
          >
            <div
              className="corpuls3-dial-inner"
              style={{ transform: `translate(-50%, -50%) rotate(${dialAngle}deg) translateY(-220%)` }}
            />
          </div>

          <div className="corpuls3-lower-grid">
            <div className="corpuls3-control-buttons">
              <button type="button" disabled={!deviceOn} className={mode === 'monitor' ? 'active' : ''} onMouseDown={onMonitorKeyDown} onMouseUp={onMonitorKeyUp} onTouchStart={onMonitorKeyDown} onTouchEnd={onMonitorKeyUp} title="IFU: Monitor key selects monitoring functions; hold >3s to invert colors">Monitor</button>
              <button type="button" disabled={!deviceOn} className={mode === 'pacer' ? 'active' : ''} onClick={() => { setMode('pacer'); setDialContext('fields') }} title="IFU: Pacer key switches to pacer mode">Pacer</button>
              <button type="button" disabled={!deviceOn} className={mode === 'browser' ? 'active' : ''} onMouseDown={onBrowserKeyDown} onMouseUp={onBrowserKeyUp} onTouchStart={onBrowserKeyDown} onTouchEnd={onBrowserKeyUp} title="IFU: Browser key prints log; hold >3s for mission browser">Browser</button>
            </div>

            <div className="corpuls3-nav-buttons" aria-label="navigation keys">
              <span className="nav-spacer" aria-hidden="true" />
              <button type="button" onClick={onBackKey} title="IFU: Back key returns to next menu level up">â†©</button>
              <button type="button" onMouseDown={onHomeKeyDown} onMouseUp={onHomeKeyUp} onTouchStart={onHomeKeyDown} onTouchEnd={onHomeKeyUp} title="IFU: Home key switches to basic status and leaves menus; hold to lock keyboard">⌂</button>
            </div>
          </div>

          <div className="corpuls3-info-buttons" aria-label="alarm and event keys">
            <button type="button" className={alarmHistoryVisible ? 'active' : ''} onMouseDown={onAlarmKeyDown} onMouseUp={onAlarmKeyUp} onTouchStart={onAlarmKeyDown} onTouchEnd={onAlarmKeyUp} title="IFU: Alarm key shows history; hold 3s to suspend alarms">🔔</button>
            <button type="button" className={eventListVisible ? 'active' : ''} onMouseDown={onEventKeyDown} onMouseUp={onEventKeyUp} onTouchStart={onEventKeyDown} onTouchEnd={onEventKeyUp} title="IFU: Event key records timestamp; hold >3s for event list">▲</button>
          </div>

          <button type="button" className="corpuls3-print-btn" onClick={onPrintKey} title="IFU: Print key starts real-time printout of curves">🖨</button>

          {alarmHistoryVisible && alarmHistory.length > 0 && (
            <div className="corpuls3-alarm-history" aria-label="Alarm history">
              <div className="alarm-history-item">
                <span className="alarm-time">{alarmHistory[alarmHistoryIndex].time.toLocaleTimeString('en-GB')}</span>
                <span className="alarm-message">{alarmHistory[alarmHistoryIndex].message}</span>
              </div>
              <div className="alarm-nav">
                <span>{alarmHistoryIndex + 1}/{alarmHistory.length}</span>
              </div>
            </div>
          )}

          {eventListVisible && (
            <div className="corpuls3-event-list" aria-label="Event list">
              {eventHistory.length === 0 ? (
                <p>No events recorded</p>
              ) : (
                <div className="event-items">
                  {eventHistory.slice(0, 5).map((event, idx) => (
                    <div key={idx} className="event-item">
                      <span>{event.time.toLocaleTimeString('en-GB')}</span>
                      <span>{event.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {keyboardLocked && (
            <div className="corpuls3-keyboard-locked" aria-label="Keyboard locked">
              <p>Keyboard locked</p>
              <p>Hold HOME to unlock</p>
            </div>
          )}
        </aside>
      </div>

      <div className={`corpuls3-display-overlay ${invertedColors ? 'inverted' : ''}`.trim()} aria-hidden="true" />
    </section>
  )
}

const MonitorScreen = ({ state, title, compact = false, flavor, triggerNibpReading }: MonitorProps) => {
  if (flavor === 'intellivue') {
    return <IntellivueScreen state={state} triggerNibpReading={triggerNibpReading} />
  }

  if (flavor === 'corpuls3') {
    return <Corpuls3Screen state={state} />
  }

  if (flavor === 'x2') {
    return <X2TransportMonitor state={state} triggerNibpReading={triggerNibpReading} />
  }

  if (flavor === 'x3') {
    return <X3PatientMonitor state={state} />
  }

  const monitorClass = `monitor-screen ${flavor} ${compact ? 'compact' : ''}`
  const { parameterVisibility } = state
  const hideSpo2Value = state.vitals.nibpSys < 60
  const hideEtco2Value = state.vitals.nibpSys < 40
  const showSpo2 = parameterVisibility.spo2 && !hideSpo2Value
  const showEtco2 = parameterVisibility.etco2 && !hideEtco2Value

  return (
    <section className={monitorClass}>
      <header>
        <h2>{title}</h2>
        <p>Rytm: {RHYTHM_LABELS[state.rhythm]} | Larm: {alarmLabel[state.alarmLevel]}</p>
      </header>

      <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact={compact} variant="ecg" rate={state.vitals.hr} />

      <div className="vital-grid">
        <VitalTile
          label="HR"
          value={parameterVisibility.hr ? String(state.vitals.hr) : ''}
          unit={parameterVisibility.hr ? 'bpm' : ''}
          tone="green"
          inactive={!parameterVisibility.hr}
        />
        <VitalTile
          label="SpO2"
          value={showSpo2 ? String(state.vitals.spo2) : ''}
          unit={showSpo2 ? '%' : ''}
          tone="blue"
          inactive={!showSpo2}
        />
        <VitalTile
          label="AF"
          value={parameterVisibility.rr ? String(state.vitals.rr) : ''}
          unit={parameterVisibility.rr ? '/min' : ''}
          tone="yellow"
          inactive={!parameterVisibility.rr}
        />
        <VitalTile
          label="ABP"
          value={parameterVisibility.abp ? `${state.vitals.nibpSys}/${state.vitals.nibpDia}` : ''}
          unit={parameterVisibility.abp ? `MAP ${state.vitals.map}` : ''}
          tone="white"
          inactive={!parameterVisibility.abp}
        />
        <VitalTile
          label="Temp"
          value={parameterVisibility.temp ? formatTemp(state.vitals.temp) : ''}
          unit={parameterVisibility.temp ? 'C' : ''}
          tone="white"
          inactive={!parameterVisibility.temp}
        />
        <VitalTile
          label="EtCO2"
          value={showEtco2 ? formatEtco2Kpa(state.vitals.etco2) : ''}
          unit={showEtco2 ? 'kPa' : ''}
          tone="yellow"
          inactive={!showEtco2}
        />
      </div>
    </section>
  )
}

const ExitButton = ({ onExit }: { onExit: () => void }) => {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')

  const close = () => { setOpen(false); setCode('') }

  const handleChange = (value: string) => {
    setCode(value)
    if (value.length === 4) {
      if (value === '3550') {
        close()
        onExit()
      } else {
        close()
      }
    }
  }

  return (
    <>
      <button className="exit-btn" type="button" onClick={() => setOpen(true)} aria-label="Avsluta vy">⌂</button>
      {open && (
        <div className="exit-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="exit-modal" onClick={(e) => e.stopPropagation()}>
            <p className="exit-modal-title">Ange kod för att avsluta</p>
            <input
              className="exit-modal-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={code}
              onChange={(e) => handleChange(e.target.value)}
              autoFocus
              placeholder="••••"
            />
            <div className="exit-modal-actions">
              <button type="button" className="ghost" onClick={close}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface FlowWaveProps {
  type: 'pressure' | 'flow' | 'co2' | 'volume'
  rr: number
  etco2: number
  ppeak: number
  peep: number
  vt: number
  color: string
  min: number
  max: number
}

const FlowWave = ({ type, rr, etco2, ppeak, peep, vt, color, min, max }: FlowWaveProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ rr, etco2, ppeak, peep, vt })
  live.current = { rr, etco2, ppeak, peep, vt }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const width = canvas.width
    const height = canvas.height
    const windowSeconds = 8
    const points: Array<[number, number]> = []
    let start: number | null = null
    let frame = 0

    const sample = (elapsedSeconds: number): number => {
      const state = live.current
      const period = 60 / clamp(state.rr, 4, 60)
      const phase = ((elapsedSeconds % period) + period) % period / period
      const inspFrac = 0.33

      if (type === 'pressure') {
        if (phase < inspFrac) {
          const t = phase / inspFrac
          const ramp = t < 0.12 ? t / 0.12 : 1
          return state.peep + (state.ppeak - state.peep) * ramp
        }
        const ex = (phase - inspFrac) / (1 - inspFrac)
        return state.peep + (state.ppeak - state.peep) * Math.exp(-6 * ex)
      }

      if (type === 'flow') {
        if (phase < inspFrac) {
          const t = phase / inspFrac
          return 0.65 * Math.sin(Math.PI * clamp(t, 0, 1))
        }
        const ex = (phase - inspFrac) / (1 - inspFrac)
        return -0.8 * Math.exp(-3 * ex)
      }

      if (type === 'co2') {
        if (phase < inspFrac) return 0
        const ex = (phase - inspFrac) / (1 - inspFrac)
        if (ex < 0.08) return 0
        if (ex < 0.22) return state.etco2 * ((ex - 0.08) / 0.14)
        if (ex < 0.86) return state.etco2
        return Math.max(0, state.etco2 * (1 - (ex - 0.86) / 0.14))
      }

      if (phase < inspFrac) {
        return state.vt * (phase / inspFrac)
      }
      return Math.max(0, state.vt * (1 - (phase - inspFrac) / (1 - inspFrac)))
    }

    const toY = (value: number) => height - ((value - min) / (max - min)) * height

    const draw = (timestamp: number) => {
      if (start === null) start = timestamp
      const elapsedSeconds = (timestamp - start) / 1000
      points.push([elapsedSeconds, sample(elapsedSeconds)])

      const cutoff = elapsedSeconds - windowSeconds
      while (points.length > 1 && points[0][0] < cutoff) points.shift()

      ctx.fillStyle = '#001a2e'
      ctx.fillRect(0, 0, width, height)

      ctx.strokeStyle = '#0d3050'
      ctx.lineWidth = 0.5
      for (let i = 0; i <= 4; i += 1) {
        const x = (i / 4) * width
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }

      if (type === 'flow') {
        const zeroY = toY(0)
        ctx.strokeStyle = '#215070'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(0, zeroY)
        ctx.lineTo(width, zeroY)
        ctx.stroke()
      }

      if (points.length > 1) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.8
        ctx.beginPath()
        points.forEach(([t, value], index) => {
          const x = ((t - cutoff) / windowSeconds) * width
          const y = toY(value)
          if (index === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [type, color, min, max])

  return <canvas ref={canvasRef} width={600} height={90} style={{ display: 'block', width: '100%', height: '100%' }} />
}

const FlowVP = ({ rr, ppeak, peep, vt }: { rr: number; ppeak: number; peep: number; vt: number }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ rr, ppeak, peep, vt })
  live.current = { rr, ppeak, peep, vt }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const width = canvas.width
    const height = canvas.height
    const pressureMax = 50
    const volumeMax = 600
    let startedAt: number | null = null
    let frame = 0

    const generate = (): Array<[number, number]> => {
      const { ppeak: ppk, peep: pep, vt: tidal } = live.current
      const points: Array<[number, number]> = []
      const steps = 90
      const inspFrac = 0.33
      for (let i = 0; i <= steps; i += 1) {
        const phase = i / steps
        let p = pep
        let v = 0
        if (phase < inspFrac) {
          const t = phase / inspFrac
          p = pep + (ppk - pep) * Math.min(1, t / 0.12)
          v = tidal * t
        } else {
          const ex = (phase - inspFrac) / (1 - inspFrac)
          p = pep + (ppk - pep) * Math.exp(-6 * ex)
          v = Math.max(0, tidal * (1 - ex))
        }
        points.push([(p / pressureMax) * width, height - (v / volumeMax) * height])
      }
      return points
    }

    const draw = (timestamp: number) => {
      if (startedAt === null) startedAt = timestamp
      const elapsed = (timestamp - startedAt) / 1000
      const period = 60 / clamp(live.current.rr, 4, 60)
      const phase = ((elapsed % period) + period) % period / period

      ctx.fillStyle = '#001a2e'
      ctx.fillRect(0, 0, width, height)

      const points = generate()
      ctx.strokeStyle = '#4a88b0'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      const index = Math.floor(phase * (points.length - 1))
      const [dx, dy] = points[index]
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(dx, dy, 3, 0, Math.PI * 2)
      ctx.fill()

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={canvasRef} width={120} height={150} style={{ display: 'block' }} />
}

const FlowPaw = ({ rr, ppeak, peep }: { rr: number; ppeak: number; peep: number }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ rr, ppeak, peep })
  live.current = { rr, ppeak, peep }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const width = canvas.width
    const height = canvas.height
    const pMax = 80
    const barX = 30
    const barW = 20
    let t0: number | null = null
    let frame = 0

    const draw = (timestamp: number) => {
      if (t0 === null) t0 = timestamp
      const elapsed = (timestamp - t0) / 1000
      const period = 60 / clamp(live.current.rr, 4, 60)
      const phase = ((elapsed % period) + period) % period / period
      const inspFrac = 0.33
      const paw = phase < inspFrac
        ? live.current.peep + (live.current.ppeak - live.current.peep) * Math.min(1, (phase / inspFrac) / 0.12)
        : live.current.peep + (live.current.ppeak - live.current.peep) * Math.exp(-6 * ((phase - inspFrac) / (1 - inspFrac)))

      ctx.fillStyle = '#001326'
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = '#0a2540'
      ctx.fillRect(barX, 0, barW, height)

      const fillHeight = (paw / pMax) * height
      const gradient = ctx.createLinearGradient(0, height - fillHeight, 0, height)
      gradient.addColorStop(0, '#ffea7a')
      gradient.addColorStop(1, '#b08010')
      ctx.fillStyle = gradient
      ctx.fillRect(barX, height - fillHeight, barW, fillHeight)

      ctx.fillStyle = '#ffd700'
      ctx.font = 'bold 16px monospace'
      ctx.fillText(Math.round(paw).toString(), barX + barW + 6, height - 10)

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={canvasRef} width={90} height={220} style={{ display: 'block' }} />
}

const FlowIScreen = ({ state, onVentilatorChange }: { state: SimulationState; onVentilatorChange?: (s: Partial<VentilatorSettings>) => void }) => {
  const { rr, etco2 } = state.vitals
  const baselineSettings: {
    apl: number
    gasMix: string
    o2Conc: number
    freshGasFlow: number
    peep: number
    respRate: number
    pcAbovePeep: number
    tidalVolume: number
  } = {
    apl: 30,
    gasMix: 'O2/AIR',
    o2Conc: 100,
    freshGasFlow: 6.0,
    peep: 5,
    respRate: 12,
    pcAbovePeep: 17,
    tidalVolume: 500,
  }

  const [apl, setApl] = useState(baselineSettings.apl)
  const [gasMix, setGasMix] = useState(baselineSettings.gasMix)
  const [o2Conc, setO2Conc] = useState(baselineSettings.o2Conc)
  const [freshGasFlow, setFreshGasFlow] = useState(baselineSettings.freshGasFlow)
  const [peep, setPeep] = useState(baselineSettings.peep)
  const [respRate, setRespRate] = useState(baselineSettings.respRate)
  const [pcAbovePeep, setPcAbovePeep] = useState(baselineSettings.pcAbovePeep)
  const [isoConc, setIsoConc] = useState(0.0)
  const [selectedParam, setSelectedParam] = useState<string | null>(null)
  const [knobAngle, setKnobAngle] = useState(0)
  const knobRef = useRef<HTMLButtonElement>(null)
  const selectedParamRef = useRef<string | null>(null)
  const knobDragRef = useRef<{ pointerId: number | null; lastAngle: number; carry: number }>({
    pointerId: null,
    lastAngle: 0,
    carry: 0,
  })
  const knobDraggedRef = useRef(false)

  // Panel / timer / case state
  const [activePanel, setActivePanel] = useState<'alarm-profile' | 'trends' | 'menu' | 'screen-layout' | 'patient' | null>(null)
  const [caseRunning, setCaseRunning] = useState(false)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trendDataRef = useRef<Array<{ t: number; ppeak: number; etco2: number; rr: number; peep: number }>>([])
  const [trendSnapshot, setTrendSnapshot] = useState<Array<{ t: number; ppeak: number; etco2: number; rr: number; peep: number }>>([])
  const currentVitalsRef = useRef({ ppeak: 0, etco2: 0, rr: 0, peep: 0 })

  // Ventilation mode
  type VentMode = 'PC' | 'VC'
  type BreathMode = 'MAN' | 'AUTO'
  const [ventMode, setVentMode] = useState<VentMode>('PC')
  const [breathMode, setBreathMode] = useState<BreathMode>('MAN')
  const [showModePanel, setShowModePanel] = useState(false)
  const [tidalVolume, setTidalVolume] = useState(baselineSettings.tidalVolume) // VC mode: ml

  // Patient data
  const [patientWeight, setPatientWeight] = useState(55)
  const [patientAge, setPatientAge] = useState(45)
  const [patientGender, setPatientGender] = useState<'M' | 'F'>('M')

  // Alarm state
  const [alarmAcked, setAlarmAcked] = useState(false)
  const alarmAckRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { selectedParamRef.current = selectedParam }, [selectedParam])

  const gasMixOptions = ['O2/AIR', 'O2', 'O2/N2O']

  const applyKnobDelta = (delta: 1 | -1) => {
    const sp = selectedParamRef.current
    if (!sp) return
    setKnobAngle((prev) => prev + delta * 18)

    if (sp === 'gasMix') {
      setGasMix((prev) => {
        const idx = gasMixOptions.indexOf(prev)
        return gasMixOptions[clamp(idx + delta, 0, gasMixOptions.length - 1)]
      })
      return
    }

    if (sp === 'apl') {
      setApl((prev) => clamp(prev + delta, 0, 80))
      return
    }
    if (sp === 'o2Conc') {
      setO2Conc((prev) => clamp(prev + delta, 21, 100))
      return
    }
    if (sp === 'freshGasFlow') {
      setFreshGasFlow((prev) => clamp(+(prev + delta * 0.1).toFixed(10), 0.1, 20.0))
      return
    }
    if (sp === 'peep') {
      setPeep((prev) => clamp(prev + delta, 0, 30))
      return
    }
    if (sp === 'respRate') {
      setRespRate((prev) => clamp(prev + delta, 4, 50))
      return
    }
    if (sp === 'pcAbovePeep') {
      setPcAbovePeep((prev) => clamp(prev + delta, 5, 40))
      return
    }
    if (sp === 'tidalVolume') {
      setTidalVolume((prev) => clamp(prev + delta * 10, 100, 1500))
      return
    }
    if (sp === 'sevoflurane') {
      setIsoConc((prev) => clamp(+(prev + delta * 0.1).toFixed(10), 0.0, 5.0))
    }
  }

  const getKnobPointerAngle = (clientX: number, clientY: number) => {
    const el = knobRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI
  }

  const handleKnobPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!selectedParamRef.current) return
    const angle = getKnobPointerAngle(e.clientX, e.clientY)
    if (angle === null) return
    knobDraggedRef.current = false
    knobDragRef.current = { pointerId: e.pointerId, lastAngle: angle, carry: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleKnobPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const drag = knobDragRef.current
    if (drag.pointerId !== e.pointerId || !selectedParamRef.current) return
    const angle = getKnobPointerAngle(e.clientX, e.clientY)
    if (angle === null) return

    let delta = angle - drag.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360

    drag.lastAngle = angle
    drag.carry += delta

    const stepAngle = 12
    while (drag.carry >= stepAngle) {
      applyKnobDelta(1)
      knobDraggedRef.current = true
      drag.carry -= stepAngle
    }
    while (drag.carry <= -stepAngle) {
      applyKnobDelta(-1)
      knobDraggedRef.current = true
      drag.carry += stepAngle
    }
  }

  const handleKnobPointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    if (knobDragRef.current.pointerId !== e.pointerId) return
    knobDragRef.current.pointerId = null
    knobDragRef.current.carry = 0
  }

  useEffect(() => {
    const el = knobRef.current
    if (!el) return
    const handler = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      const sp = selectedParamRef.current
      if (!sp) return
      const delta = e.deltaY < 0 ? 1 : -1
      applyKnobDelta(delta)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [applyKnobDelta])

  const selectParam = (key: string) => setSelectedParam((prev) => (prev === key ? null : key))
  const confirmKnob = () => setSelectedParam(null)

  // Timer
  useEffect(() => {
    if (!timerRunning) return
    const id = setInterval(() => setTimerSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [timerRunning])

  // Keep current vitals in a ref so trend sampler always reads latest values
  useEffect(() => {
    currentVitalsRef.current = { ppeak: peep + pcAbovePeep, etco2, rr: respRate, peep }
  }, [peep, pcAbovePeep, etco2, respRate])

  // Trend sampling every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      const sample = { t: Date.now(), ...currentVitalsRef.current }
      trendDataRef.current = [...trendDataRef.current.slice(-29), sample]
      setTrendSnapshot([...trendDataRef.current])
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // Sync Flow-I settings to shared simulation state so instructor's "Ventileras" can read them
  const onVentilatorChangeRef = useRef(onVentilatorChange)
  useEffect(() => { onVentilatorChangeRef.current = onVentilatorChange })
  useEffect(() => {
    onVentilatorChangeRef.current?.({ rr: Math.round(respRate), fio2: Math.round(o2Conc), peep: Math.round(peep), vt: Math.round(tidalVolume), weight: patientWeight })
  }, [respRate, o2Conc, peep, tidalVolume, patientWeight])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  const resetFlowIBaseline = () => {
    setApl(baselineSettings.apl)
    setGasMix(baselineSettings.gasMix)
    setO2Conc(baselineSettings.o2Conc)
    setFreshGasFlow(baselineSettings.freshGasFlow)
    setPeep(baselineSettings.peep)
    setRespRate(baselineSettings.respRate)
    setPcAbovePeep(baselineSettings.pcAbovePeep)
    setTidalVolume(baselineSettings.tidalVolume)
    setIsoConc(0)
    setSelectedParam(null)
  }

  const formatTimer = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const handleKnobClick = () => {
    if (knobDraggedRef.current) {
      knobDraggedRef.current = false
      return
    }
    confirmKnob()
  }

  const ppeak = peep + pcAbovePeep
  const vti = ventMode === 'VC' ? tidalVolume : 357
  const vte = ventMode === 'VC' ? Math.round(tidalVolume * 0.99) : 354
  const mvi = (respRate * vti / 1000).toFixed(1)
  const mve = (respRate * vte / 1000).toFixed(1)

  // Alarm detection (based on measured values from simulation state)
  const alarmLimitsRef = {
    etco2High: 55,
    etco2Low: 20,
    rrHigh: 35,
    rrLow: 5,
    ppeakHigh: ppeak + 10,
  }
  const activeAlarms: string[] = []
  if (caseRunning && !alarmAcked) {
    if (etco2 > alarmLimitsRef.etco2High) activeAlarms.push(`EtCOâ‚‚ HÖG  ${etco2}`)
    if (etco2 < alarmLimitsRef.etco2Low && etco2 > 0) activeAlarms.push(`EtCOâ‚‚ LÅG  ${etco2}`)
    if (rr > alarmLimitsRef.rrHigh) activeAlarms.push(`RR HÖG  ${rr}`)
    if (rr < alarmLimitsRef.rrLow && rr > 0) activeAlarms.push(`RR LÅG  ${rr}`)
  }
  const hasAlarm = activeAlarms.length > 0

  const acknowledgeAlarm = () => {
    setAlarmAcked(true)
    if (alarmAckRef.current) clearTimeout(alarmAckRef.current)
    alarmAckRef.current = setTimeout(() => setAlarmAcked(false), 120_000)
  }

  const now = new Date()
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <section className="flowi-screen" aria-label="Flow-I display">
      {/* â”€â”€ ALARM STRIP â”€â”€ */}
      {hasAlarm && (
        <div className="flowi-alarm-strip">
          <span className="flowi-alarm-strip-icon">âš </span>
          <span className="flowi-alarm-strip-text">
            {activeAlarms.join('  ·  ')}
          </span>
          <button type="button" className="flowi-alarm-ack-btn" onClick={acknowledgeAlarm}>
            ACK
          </button>
        </div>
      )}

      <div className="flowi-header">
        <div
          className="flowi-patient-info flowi-patient-info--clickable"
          role="button"
          tabIndex={0}
          aria-label="Patientdata"
          onClick={() => setActivePanel(prev => prev === 'patient' ? null : 'patient')}
          onKeyDown={e => e.key === 'Enter' && setActivePanel(prev => prev === 'patient' ? null : 'patient')}
        >
          <span className="flowi-patient-icon">â—§</span>
          <div className="flowi-patient-details">
            <span className="flowi-patient-label">PBW {patientWeight} kg</span>
            <span className="flowi-patient-sub">{patientAge} år · {patientGender === 'M' ? '♂' : '♀'}</span>
          </div>
        </div>
        <div className="flowi-header-center">
          <span className="flowi-datetime">{dateStr} {timeStr}</span>
          {(timerSeconds > 0 || timerRunning) && (
            <span className={`flowi-timer-display${timerRunning ? ' flowi-timer-running' : ''}`}>
              {formatTimer(timerSeconds)}
            </span>
          )}
        </div>
        <div
          className="flowi-mode-area flowi-mode-area--clickable"
          role="button"
          tabIndex={0}
          aria-label="Välj ventilationsläge"
          onClick={() => setShowModePanel(prev => !prev)}
          onKeyDown={e => e.key === 'Enter' && setShowModePanel(prev => !prev)}
        >
          <div className="flowi-mode-primary">
            {ventMode === 'PC' ? 'PRESSURE CONTROL' : 'VOLUME CONTROL'}
          </div>
          <div className="flowi-mode-secondary">{breathMode}</div>
        </div>
      </div>

      {/* â”€â”€ MODE SELECTION PANEL â”€â”€ */}
      {showModePanel && (
        <div className="flowi-mode-dropdown">
          {([['PC', 'MAN'], ['PC', 'AUTO'], ['VC', 'MAN'], ['VC', 'AUTO']] as [VentMode, BreathMode][]).map(([vm, bm]) => (
            <button
              key={`${vm}-${bm}`}
              type="button"
              className={`flowi-mode-option${ventMode === vm && breathMode === bm ? ' flowi-mode-option--active' : ''}`}
              onClick={() => { setVentMode(vm); setBreathMode(bm); setShowModePanel(false) }}
            >
              <span className="flowi-mode-opt-primary">{vm === 'PC' ? 'PRESSURE CONTROL' : 'VOLUME CONTROL'}</span>
              <span className="flowi-mode-opt-secondary">{bm}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flowi-main">
        <aside className="flowi-left-panel">
          <div className="flowi-vrow flowi-vrow-top">
            <div className="flowi-vparam">
              <span className="flowi-vp-name">Ppeak cmH2O</span>
              <span className="flowi-vp-val flowi-col-yellow">{ppeak}</span>
            </div>
            <div className="flowi-vparam">
              <span className="flowi-vp-name">PEEP cmH2O</span>
              <span className="flowi-vp-val flowi-col-cyan">{peep}</span>
            </div>
          </div>
          <div className="flowi-vrow">
            <div className="flowi-vparam flowi-vparam-sm">
              <span className="flowi-vp-name">MVi</span>
              <span className="flowi-vp-val">{mvi}</span>
            </div>
            <div className="flowi-vparam flowi-vparam-sm">
              <span className="flowi-vp-name">VTi</span>
              <span className="flowi-vp-val">{vti}</span>
            </div>
          </div>
          <div className="flowi-vrow">
            <div className="flowi-vparam flowi-vparam-sm">
              <span className="flowi-vp-name">MVe</span>
              <span className="flowi-vp-val">{mve}</span>
            </div>
            <div className="flowi-vparam flowi-vparam-sm">
              <span className="flowi-vp-name">VTe</span>
              <span className="flowi-vp-val">{vte}</span>
            </div>
          </div>
          <div className="flowi-vrow">
            <div className="flowi-vparam flowi-vparam-rr">
              <span className="flowi-vp-name">RR b/min</span>
              <span className="flowi-vp-val flowi-col-green flowi-rr-big">{Math.round(respRate)}</span>
            </div>
          </div>
        </aside>

        <div className="flowi-waveforms-col">
          {[
            { type: 'pressure' as const, label: 'Pressure', unit: 'cmH2O', scale: '40', color: '#ffd700', min: 0, max: 45 },
            { type: 'flow' as const, label: 'Flow', unit: 'l/s', scale: '1.0', color: '#38d45f', min: -1.2, max: 1.2 },
            { type: 'co2' as const, label: 'CO2', unit: 'mmHg', scale: '60', color: '#ffd700', min: 0, max: 65 },
            { type: 'volume' as const, label: 'Volume', unit: 'ml', scale: '600', color: '#4ca0ff', min: 0, max: 650 },
          ].map((wave) => (
            <div key={wave.type} className="flowi-wave-row">
              <div className="flowi-wave-meta">
                <span className="flowi-wave-scale">{wave.scale}</span>
                <span className="flowi-wave-label" style={{ color: wave.color }}>{wave.label}</span>
                <span className="flowi-wave-unit">{wave.unit}</span>
              </div>
              <div className="flowi-wave-canvas-wrap">
                <FlowWave
                  type={wave.type}
                  rr={respRate}
                  etco2={etco2}
                  ppeak={ppeak}
                  peep={peep}
                  vt={vti}
                  color={wave.color}
                  min={wave.min}
                  max={wave.max}
                />
              </div>
            </div>
          ))}
        </div>

        <aside className="flowi-right-panel">
          <div className="flowi-vp-section">
            <div className="flowi-vp-title">Volume - Pressure</div>
            <FlowVP rr={respRate} ppeak={ppeak} peep={peep} vt={vti} />
          </div>
          <div className="flowi-paw-section">
            <div className="flowi-paw-title">Paw cmH2O</div>
            <FlowPaw rr={respRate} ppeak={ppeak} peep={peep} />
          </div>
        </aside>

        <aside className="flowi-control-column" aria-label="Flow-I reglagepanel">
          <div className="flowi-ctrl-top-group">
            <button
              type="button"
              className={`flowi-ctrl-btn flowi-ctrl-alarm${activePanel === 'alarm-profile' ? ' flowi-ctrl-btn--active' : ''}`}
              onClick={() => setActivePanel(prev => prev === 'alarm-profile' ? null : 'alarm-profile')}
            >
              <span className="flowi-ctrl-icon">â—Ž</span>
              <span>Alarm profile</span>
            </button>

            <div className="flowi-ctrl-pill-row">
              <button
                type="button"
                className={`flowi-ctrl-pill${caseRunning ? ' flowi-ctrl-pill-active' : ' flowi-ctrl-pill-green'}`}
                onClick={() => setCaseRunning(true)}
              >Start case</button>
              <button
                type="button"
                className="flowi-ctrl-pill"
                onClick={() => {
                  setCaseRunning(false)
                  resetFlowIBaseline()
                  showToast('Grundinstallningar aterstallda')
                }}
              >End case</button>
            </div>

            <div className="flowi-ctrl-grid-2">
              <button
                type="button"
                className="flowi-ctrl-btn"
                onClick={() => showToast('Skärm sparad till USB')}
              >Save screen</button>
              <button
                type="button"
                className={`flowi-ctrl-btn${activePanel === 'trends' ? ' flowi-ctrl-btn--active' : ''}`}
                onClick={() => setActivePanel(prev => prev === 'trends' ? null : 'trends')}
              >Trends</button>
              <button
                type="button"
                className={`flowi-ctrl-btn${timerRunning ? ' flowi-ctrl-btn--active' : ''}`}
                onClick={() => setTimerRunning(prev => !prev)}
              >Start/Stop</button>
              <button
                type="button"
                className="flowi-ctrl-btn"
                onClick={() => { setTimerRunning(false); setTimerSeconds(0) }}
              >Reset</button>
            </div>
          </div>

          <div className="flowi-ctrl-divider" />

          <div className="flowi-ctrl-mid-group">
            <button
              type="button"
              className="flowi-ctrl-home-btn"
              onClick={() => setActivePanel(null)}
            >
              <span className="flowi-ctrl-home-icon">⌂</span>
            </button>

            <div className="flowi-ctrl-grid-2 flowi-ctrl-grid-bottom">
              <button
                type="button"
                className={`flowi-ctrl-btn${activePanel === 'screen-layout' ? ' flowi-ctrl-btn--active' : ''}`}
                onClick={() => setActivePanel(prev => prev === 'screen-layout' ? null : 'screen-layout')}
              >Screen layout</button>
              <button
                type="button"
                className={`flowi-ctrl-btn${activePanel === 'menu' ? ' flowi-ctrl-btn--active' : ''}`}
                onClick={() => setActivePanel(prev => prev === 'menu' ? null : 'menu')}
              >Menu</button>
            </div>
          </div>

          <div className="flowi-ctrl-knob-wrap">
            <button
              ref={knobRef}
              type="button"
              className={`flowi-ctrl-knob${selectedParam ? ' flowi-ctrl-knob--active' : ''}`}
              aria-label="Flow-I ratt – tryck för att bekräfta"
              onClick={handleKnobClick}
              onPointerDown={handleKnobPointerDown}
              onPointerMove={handleKnobPointerMove}
              onPointerUp={handleKnobPointerEnd}
              onPointerCancel={handleKnobPointerEnd}
              onLostPointerCapture={handleKnobPointerEnd}
              style={{ transform: `rotate(${knobAngle}deg)` }}
            >
              <span className="flowi-ctrl-knob-indicator" />
            </button>
          </div>
        </aside>
      </div>

      <div className="flowi-settings-bar">
        <div className={`flowi-sbox flowi-sbox-narrow${selectedParam === 'apl' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">APL</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('apl')}>
            <span className="flowi-sbox-main">{!caseRunning ? 'SP' : Math.round(apl)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">cmH2O</span>
            <span className="flowi-sbox-scale">{!caseRunning ? '' : '0 80'}</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'gasMix' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Gasmix</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('gasMix')}>
            <span className="flowi-sbox-main flowi-sbox-main-dark">{gasMix}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit"> </span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'freshGasFlow' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Färskgasflöde</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('freshGasFlow')}>
            <span className="flowi-sbox-main">{freshGasFlow.toFixed(1)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">l/min</span>
            <span className="flowi-sbox-scale">0.1 20.0</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'o2Conc' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Oâ‚‚ konc.</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('o2Conc')}>
            <span className="flowi-sbox-main">{Math.round(o2Conc)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">%</span>
            <span className="flowi-sbox-scale">21 100</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'sevoflurane' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Sevofluran</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('sevoflurane')}>
            <span className="flowi-sbox-main flowi-sbox-main-dark">{isoConc === 0 ? 'OFF' : isoConc.toFixed(1)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">%</span>
            <span className="flowi-sbox-scale">0.0 5.0</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'peep' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">PEEP</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('peep')}>
            <span className="flowi-sbox-main">{Math.round(peep)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">cmH2O</span>
            <span className="flowi-sbox-scale">0 50</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'respRate' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Frekvens</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('respRate')}>
            <span className="flowi-sbox-main">{Math.round(respRate)}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">b/min</span>
            <span className="flowi-sbox-scale">4 100</span>
          </div>
        </div>

        <div className={`flowi-sbox flowi-sbox-medium${selectedParam === 'tidalVolume' ? ' flowi-sbox--active' : ''}`}>
          <div className="flowi-sbox-head">Tidalvolym</div>
          <button type="button" className="flowi-sbox-edit" onClick={() => selectParam('tidalVolume')}>
            <span className="flowi-sbox-main">{tidalVolume}</span>
          </button>
          <div className="flowi-sbox-foot">
            <span className="flowi-sbox-unit">ml</span>
            <span className="flowi-sbox-scale">100 2000</span>
          </div>
        </div>
      </div>

      {/* â”€â”€ OVERLAYS â”€â”€ */}
      {activePanel === 'alarm-profile' && (
        <div className="flowi-overlay" onClick={() => setActivePanel(null)}>
          <div className="flowi-panel" onClick={e => e.stopPropagation()}>
            <div className="flowi-panel-header">
              <span>Alarm Profile</span>
              <button type="button" className="flowi-panel-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="flowi-panel-body">
              <table className="flowi-alarm-table">
                <thead>
                  <tr><th>Parameter</th><th>Lågt larm</th><th>Högt larm</th></tr>
                </thead>
                <tbody>
                  <tr><td>Ppeak (cmH2O)</td><td>—</td><td>{ppeak + 10}</td></tr>
                  <tr><td>PEEP (cmH2O)</td><td>{Math.max(0, peep - 3)}</td><td>—</td></tr>
                  <tr><td>RR (b/min)</td><td>4</td><td>40</td></tr>
                  <tr><td>VTe (ml)</td><td>200</td><td>800</td></tr>
                  <tr><td>EtCO2 (mmHg)</td><td>20</td><td>60</td></tr>
                  <tr><td>O2 (%)</td><td>18</td><td>100</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activePanel === 'trends' && (
        <div className="flowi-overlay" onClick={() => setActivePanel(null)}>
          <div className="flowi-panel flowi-panel-wide" onClick={e => e.stopPropagation()}>
            <div className="flowi-panel-header">
              <span>Trends</span>
              <button type="button" className="flowi-panel-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="flowi-panel-body">
              {trendSnapshot.length === 0 ? (
                <p className="flowi-panel-empty">Ingen trenddata tillgänglig ännu. Data samlas var 5:e sekund.</p>
              ) : (
                <table className="flowi-alarm-table">
                  <thead>
                    <tr><th>Tid</th><th>Ppeak</th><th>PEEP</th><th>EtCO2</th><th>RR</th></tr>
                  </thead>
                  <tbody>
                    {[...trendSnapshot].reverse().map((s, i) => (
                      <tr key={i}>
                        <td>{new Date(s.t).toLocaleTimeString()}</td>
                        <td>{s.ppeak}</td>
                        <td>{s.peep}</td>
                        <td>{s.etco2}</td>
                        <td>{s.rr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {activePanel === 'menu' && (
        <div className="flowi-overlay" onClick={() => setActivePanel(null)}>
          <div className="flowi-panel" onClick={e => e.stopPropagation()}>
            <div className="flowi-panel-header">
              <span>Menu</span>
              <button type="button" className="flowi-panel-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="flowi-panel-body">
              <ul className="flowi-menu-list">
                {['Patientinställningar', 'System checkout', 'Status', 'Loggar', 'Spara & ta bort data', 'Tjänst & inställningar', 'Panellås'].map(item => (
                  <li key={item}>
                    <button type="button" className="flowi-menu-item" onClick={() => setActivePanel(null)}>
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {activePanel === 'screen-layout' && (
        <div className="flowi-overlay" onClick={() => setActivePanel(null)}>
          <div className="flowi-panel" onClick={e => e.stopPropagation()}>
            <div className="flowi-panel-header">
              <span>Screen layout</span>
              <button type="button" className="flowi-panel-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="flowi-panel-body">
              <div className="flowi-layout-section">
                <p className="flowi-layout-label">Layout</p>
                <div className="flowi-layout-options">
                  {['Vågor + Loopar', 'Vågor', 'Loopar', 'Vågor + Rotameter'].map(opt => (
                    <button key={opt} type="button" className="flowi-layout-opt">{opt}</button>
                  ))}
                </div>
              </div>
              <div className="flowi-layout-section">
                <p className="flowi-layout-label">Ljusstyrka</p>
                <input type="range" min={10} max={100} defaultValue={80} className="flowi-brightness-slider" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ STANDBY OVERLAY â”€â”€ */}
      {!caseRunning && (
        <div className="flowi-standby-overlay">
          <div className="flowi-standby-shell">
            <div className="flowi-standby-warnings" aria-hidden="true">
              <span>O2-forsorjningstryck: Lagt</span>
              <span>Luftforsorjningstryck: Lagt</span>
              <span>Vattenfalla saknas</span>
            </div>

            <div className="flowi-standby-banner">
              <span>TRYCK "STARTA FALL"</span>
              <span>FÖR ATT STARTA VENTILATION</span>
            </div>

            <div className="flowi-standby-card">
              <div className="flowi-standby-time">{dateStr} {timeStr}</div>
              <div className="flowi-standby-divider" />

              <div className="flowi-standby-status-row">
                <div className="flowi-standby-alert-icon flowi-standby-alert-icon--ok" aria-hidden="true">✓</div>
                <div className="flowi-standby-status-text">
                  <h3>SYSTEMKONTROLL UTFÖRD</h3>
                  <p>SYSTEM REDO FÖR ANVÄNDNING</p>
                </div>
              </div>

              <div className="flowi-standby-actions">
                <button type="button" className="flowi-standby-btn" onClick={() => showToast('Resultatvisning öppnad')}>
                  Visa resultat
                </button>
                <button type="button" className="flowi-standby-btn" onClick={() => showToast('Full kontroll startad')}>
                  Full kontroll
                </button>
                <button type="button" className="flowi-standby-btn" onClick={() => showToast('Läckagetest startat')}>
                  Läckagetest
                </button>
                <button type="button" className="flowi-standby-btn" onClick={() => showToast('Förgasarkontroll startad')}>
                  Förgasarkontroll
                </button>
              </div>
            </div>

            <div className="flowi-standby-patient-row">
              <span>Vuxen</span>
              <span>{patientAge} år</span>
              <span>{patientWeight} kg</span>
              <span>— cm</span>
              <span>—</span>
              <button
                type="button"
                className="flowi-standby-patient-btn"
                onClick={() => setActivePanel('patient')}
              >
                Patientinställningar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ PATIENT PANEL â”€â”€ */}
      {activePanel === 'patient' && (
        <div className="flowi-overlay" onClick={() => setActivePanel(null)}>
          <div className="flowi-panel" onClick={e => e.stopPropagation()}>
            <div className="flowi-panel-header">
              <span>Patientdata</span>
              <button type="button" className="flowi-panel-close" onClick={() => setActivePanel(null)}>✕</button>
            </div>
            <div className="flowi-panel-body">
              <div className="flowi-patient-form">
                <label className="flowi-pf-label">
                  PBW / Vikt (kg)
                  <div className="flowi-pf-stepper">
                    <button type="button" onClick={() => setPatientWeight(w => Math.max(30, w - 1))}>−</button>
                    <span>{patientWeight}</span>
                    <button type="button" onClick={() => setPatientWeight(w => Math.min(200, w + 1))}>+</button>
                  </div>
                </label>
                <label className="flowi-pf-label">
                  Ålder
                  <div className="flowi-pf-stepper">
                    <button type="button" onClick={() => setPatientAge(a => Math.max(0, a - 1))}>−</button>
                    <span>{patientAge}</span>
                    <button type="button" onClick={() => setPatientAge(a => Math.min(120, a + 1))}>+</button>
                  </div>
                </label>
                <label className="flowi-pf-label">
                  Kön
                  <div className="flowi-pf-gender">
                    <button
                      type="button"
                      className={`flowi-pf-gender-btn${patientGender === 'M' ? ' flowi-pf-gender-btn--active' : ''}`}
                      onClick={() => setPatientGender('M')}
                    >♂ Man</button>
                    <button
                      type="button"
                      className={`flowi-pf-gender-btn${patientGender === 'F' ? ' flowi-pf-gender-btn--active' : ''}`}
                      onClick={() => setPatientGender('F')}
                    >♀ Kvinna</button>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="flowi-toast">{toast}</div>
      )}
    </section>
  )
}

const MediaScreen = ({ state, channel }: { state: SimulationState; channel: MediaChannel }) => {
  const activeId = state.activeMediaByChannel[channel]
  const active = state.mediaLibrary.find((item) => item.id === activeId) ?? null
  const activeSound = state.soundLibrary.find((item) => item.id === state.activeSoundId) ?? null

  if (channel === 'lab') {
    return (
      <section className="media-screen media-screen-lab" aria-label="Provsvar och blodgas display">
        {activeSound ? <audio src={activeSound.url} autoPlay loop /> : null}
        <div className="lab-bloodgas-panel">
          <div className="lab-bloodgas-header">
            <h2>Provsvar och blodgas</h2>
            <p>Automatiskt genererad utifrån patientstatus och händelser</p>
          </div>
          <BloodGasValuesGrid
            values={state.bloodGas}
            sampleType={state.bloodGasSampleType}
            generatedAt={state.updatedAt}
          />
        </div>
        <div className="lab-media-area">
          {active ? (
            active.type === 'image' ? (
              <img className="media-content" src={active.url} alt={active.title} />
            ) : (
              <video
                className="media-content"
                src={active.url}
                autoPlay
                loop
                playsInline
                muted
              />
            )
          ) : (
            <div className="lab-media-placeholder">Väntar på provsvar/blodgasmedia från instruktörsskärmen</div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="media-screen" aria-label="Media display">
      {activeSound ? <audio src={activeSound.url} autoPlay loop /> : null}
      {active ? (
        active.type === 'image' ? (
          <img className="media-content" src={active.url} alt={active.title} />
        ) : (
          <video
            className="media-content"
            src={active.url}
            autoPlay
            loop
            playsInline
            muted
          />
        )
      ) : null}
    </section>
  )
}

const HamiltonT1Screen = ({ state, onVentilatorChange }: { state: SimulationState; onVentilatorChange?: (s: Partial<VentilatorSettings>) => void }) => {
  const MODES = [
    { id: 'scmv',   label: '(S)CMV+',  full: 'APCmv / (S)CMV+' },
    { id: 'simv',   label: 'SIMV+',    full: 'APCsimv / SIMV+' },
    { id: 'pcmv',   label: 'P-CMV',    full: 'Pressure-controlled CMV' },
    { id: 'psmv',   label: 'P-SIMV',   full: 'Pressure-controlled SIMV' },
    { id: 'duopap', label: 'DuoPAP',   full: 'Duo Positive Airway Pressure' },
    { id: 'aprv',   label: 'APRV',     full: 'Airway Pressure Release Ventilation' },
    { id: 'spont',  label: 'SPONT',    full: 'Spontaneous / Pressure Support' },
    { id: 'asv',    label: 'ASV',      full: 'Adaptive Support Ventilation' },
    { id: 'niv',    label: 'NIV',      full: 'Non-Invasive Ventilation' },
    { id: 'niv-st', label: 'NIV-ST',   full: 'NIV with backup rate' },
  ] as const
  type ModeId = typeof MODES[number]['id']

  const [activeMode, setActiveMode] = useState<ModeId>('scmv')
  const [audioPauseUntil, setAudioPauseUntil] = useState<number | null>(null)
  const [screenLocked, setScreenLocked] = useState(false)
  const [standby, setStandby] = useState(false)
  const [inspHoldActive, setInspHoldActive] = useState(false)
  const [expHoldActive, setExpHoldActive] = useState(false)
  const [o2FlushActive, setO2FlushActive] = useState(false)
  const [activeTab, setActiveTab] = useState<'monitoring' | 'tools' | 'events' | 'system'>('monitoring')
  const [showModeMenu, setShowModeMenu] = useState(false)

  const audioMuted = audioPauseUntil !== null

  useEffect(() => {
    if (audioPauseUntil === null) return
    const msLeft = audioPauseUntil - Date.now()
    if (msLeft <= 0) {
      setAudioPauseUntil(null)
      return
    }
    const timer = window.setTimeout(() => setAudioPauseUntil(null), msLeft)
    return () => window.clearTimeout(timer)
  }, [audioPauseUntil])

  useEffect(() => {
    if (!inspHoldActive) return
    const timer = window.setTimeout(() => setInspHoldActive(false), 3000)
    return () => window.clearTimeout(timer)
  }, [inspHoldActive])

  useEffect(() => {
    if (!expHoldActive) return
    const timer = window.setTimeout(() => setExpHoldActive(false), 3000)
    return () => window.clearTimeout(timer)
  }, [expHoldActive])

  useEffect(() => {
    if (!o2FlushActive) return
    const timer = window.setTimeout(() => setO2FlushActive(false), 12000)
    return () => window.clearTimeout(timer)
  }, [o2FlushActive])

  const modeInfo = MODES.find(m => m.id === activeMode) ?? MODES[0]

  // ── Derived MMP (Main Monitoring Parameters, ch.8) ───────────────────────────
  const ppeak   = Math.round(clamp(12 + state.vitals.rr * 0.6 + (state.vitals.etco2 - 28) * 0.1, 8, 50))
  const pmean   = Math.round(clamp(ppeak * 0.42, 3, 22))
  const vte     = Math.round(clamp(420 + state.vitals.rr * 4 + (state.vitals.etco2 - 28) * 6, 150, 900))
  const mve     = parseFloat(((vte * state.vitals.rr) / 1000).toFixed(1))
  const ftotal  = state.vitals.rr
  const fspont  = (activeMode === 'spont' || activeMode === 'niv' || activeMode === 'niv-st')
    ? state.vitals.rr : Math.round(state.vitals.rr * 0.25)

  // ── Set parameters (editable via rotary knob) ─────────────────────────────────
  const [vtSet,      setVtSet]      = useState(500)
  const [peepSet,    setPeepSet]    = useState(5)
  const [rateSet,    setRateSet]    = useState(14)
  const [pInspSet,   setPInspSet]   = useState(18)
  const [psSet,      setPsSet]      = useState(12)
  const [fio2Set,    setFio2Set]    = useState(50)
  const [tiSet,      setTiSet]      = useState(1.0)
  const [mvolPct,    setMvolPct]    = useState(100)
  const [thighSet,   setThighSet]   = useState(1.5)
  const [tlowSet,    setTlowSet]    = useState(0.6)
  const [triggerSet, setTriggerSet] = useState(2.0)
  const [selectedParam, setSelectedParam] = useState<string | null>(null)
  const [knobAngle, setKnobAngle] = useState(0)

  type ParamCfg = { set: (fn: (prev: number) => number) => void; min: number; max: number; step: number; dec?: number }
  const paramConfig: Record<string, ParamCfg> = {
    'Vt':        { set: setVtSet,      min: 100,  max: 900,  step: 10  },
    'PEEP':      { set: setPeepSet,    min: 0,    max: 20,   step: 1   },
    'PEEP/CPAP': { set: setPeepSet,    min: 0,    max: 20,   step: 1   },
    'Rate':      { set: setRateSet,    min: 4,    max: 60,   step: 1   },
    'FiO\u2082': { set: setFio2Set,    min: 21,   max: 100,  step: 1   },
    'Pinsp':     { set: setPInspSet,   min: 5,    max: 50,   step: 1   },
    'PS':        { set: setPsSet,      min: 0,    max: 30,   step: 1   },
    'Ti':        { set: setTiSet,      min: 0.1,  max: 5.0,  step: 0.1, dec: 1 },
    '%MinVol':   { set: setMvolPct,    min: 20,   max: 200,  step: 5   },
    'Phigh':     { set: setPInspSet,   min: 5,    max: 55,   step: 1   },
    'Plow':      { set: setPeepSet,    min: 0,    max: 20,   step: 1   },
    'Thigh':     { set: setThighSet,   min: 0.1,  max: 12.0, step: 0.1, dec: 1 },
    'Tlow':      { set: setTlowSet,    min: 0.05, max: 2.0,  step: 0.05, dec: 2 },
    'Trigger':   { set: setTriggerSet, min: 0.5,  max: 15,   step: 0.5, dec: 1 },
  }

  // Sync Hamilton T1 settings to shared simulation state so instructor's "Ventileras" can read them
  const onVentilatorChangeRef = useRef(onVentilatorChange)
  useEffect(() => { onVentilatorChangeRef.current = onVentilatorChange })
  useEffect(() => {
    onVentilatorChangeRef.current?.({ rr: rateSet, fio2: fio2Set, peep: peepSet, vt: vtSet })
  }, [rateSet, fio2Set, peepSet, vtSet])

  const handleParamClick = (label: string) => {
    if (screenLocked || standby) return
    setSelectedParam(prev => (prev === label ? null : label))
  }

  type SetParam = { label: string; value: string | number; unit: string }
  const setParams: SetParam[] = (() => {
    switch (activeMode) {
      case 'scmv': return [
        { label: 'Vt', value: vtSet, unit: 'ml' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
        { label: 'FiO₂', value: fio2Set, unit: '%' },
      ]
      case 'simv': return [
        { label: 'Vt', value: vtSet, unit: 'ml' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
        { label: 'PS', value: psSet, unit: 'cmH₂O' },
      ]
      case 'pcmv': return [
        { label: 'Pinsp', value: pInspSet, unit: 'cmH₂O' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
        { label: 'Ti', value: tiSet.toFixed(1), unit: 's' },
      ]
      case 'psmv': return [
        { label: 'Pinsp', value: pInspSet, unit: 'cmH₂O' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
        { label: 'PS', value: psSet, unit: 'cmH₂O' },
      ]
      case 'duopap': return [
        { label: 'Phigh', value: pInspSet, unit: 'cmH₂O' },
        { label: 'Thigh', value: thighSet.toFixed(1), unit: 's' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
      ]
      case 'aprv': return [
        { label: 'Phigh', value: pInspSet, unit: 'cmH₂O' },
        { label: 'Plow', value: peepSet, unit: 'cmH₂O' },
        { label: 'Thigh', value: thighSet.toFixed(1), unit: 's' },
        { label: 'Tlow', value: tlowSet.toFixed(2), unit: 's' },
      ]
      case 'spont': return [
        { label: 'PS', value: psSet, unit: 'cmH₂O' },
        { label: 'PEEP/CPAP', value: peepSet, unit: 'cmH₂O' },
        { label: 'FiO₂', value: fio2Set, unit: '%' },
        { label: 'Trigger', value: triggerSet.toFixed(1), unit: 'l/min' },
      ]
      case 'asv': return [
        { label: '%MinVol', value: mvolPct, unit: '%' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'FiO₂', value: fio2Set, unit: '%' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
      ]
      case 'niv':
      case 'niv-st': return [
        { label: 'Pinsp', value: pInspSet, unit: 'cmH₂O' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'FiO₂', value: fio2Set, unit: '%' },
        { label: 'Rate', value: activeMode === 'niv-st' ? rateSet : 0, unit: 'b/min' },
      ]
      default: return []
    }
  })()

  const alarmHigh = state.alarmLevel === 'critical'
  const alarmMed  = state.alarmLevel === 'warning'
  const alarmText = alarmHigh ? 'High-priority alarm' : alarmMed ? 'Medium-priority alarm' : ''
  const alarmCls  = alarmHigh
    ? 'hamt1-alarm hamt1-alarm--high'
    : alarmMed
      ? 'hamt1-alarm hamt1-alarm--med'
      : 'hamt1-alarm hamt1-alarm--none'

  const statusText = standby
    ? 'Standby: ventilation paused'
    : o2FlushActive
      ? 'O2 flush active (100% O2)'
      : inspHoldActive
        ? 'Inspiratory hold active'
        : expHoldActive
          ? 'Expiratory hold active'
          : screenLocked
            ? 'Screen locked'
            : 'Ventilation active'

  const fio2SetDisplay = o2FlushActive ? 100 : fio2Set
  // fio2MeasDisplay removed (Measured section replaced by Controls/Alarms nav)
  const displayValue = (value: number | string) => (standby ? '--' : value)

  const tabDetails: Record<'monitoring' | 'tools' | 'events' | 'system', string> = {
    monitoring: `Mode ${modeInfo.label} | MVe ${standby ? '--' : mve.toFixed(1)} l/min | fTotal ${standby ? '--' : ftotal}`,
    tools: 'Quick tools: hold maneuvers, O2 flush, audio pause, standby toggle.',
    events: `Alarm ${state.alarmLevel} | ${audioMuted ? 'Audio paused' : 'Audio active'} | ${statusText}`,
    system: `${screenLocked ? 'Locked' : 'Unlocked'} | Adult patient group | Battery and system checks simulated.`,
  }

  const handleStandbyToggle = () => {
    if (screenLocked) return
    setStandby(prev => {
      const next = !prev
      if (next) {
        setInspHoldActive(false)
        setExpHoldActive(false)
        setO2FlushActive(false)
        setShowModeMenu(false)
      }
      return next
    })
  }

  const handleAudioPause = () => {
    if (screenLocked) return
    if (audioMuted) {
      setAudioPauseUntil(null)
      return
    }
    setAudioPauseUntil(Date.now() + 120000)
  }

  const handleInspHold = () => {
    if (screenLocked || standby) return
    setExpHoldActive(false)
    setInspHoldActive(true)
  }

  const handleExpHold = () => {
    if (screenLocked || standby) return
    setInspHoldActive(false)
    setExpHoldActive(true)
  }

  const handleO2Flush = () => {
    if (screenLocked || standby) return
    setO2FlushActive(true)
  }

  // True rotary: measure pointer angle relative to knob centre.
  // Clockwise delta → higher value, counter-clockwise → lower.
  const knobDragRef = useRef<{ lastAngle: number; lastSteps: number; startY: number; moved: boolean } | null>(null)
  const knobElRef   = useRef<HTMLDivElement>(null)
  const latestKnob  = useRef({ selectedParam, screenLocked, standby, paramConfig })
  latestKnob.current = { selectedParam, screenLocked, standby, paramConfig }

  const DEGREES_PER_STEP = 10  // degrees of rotation per one parameter step

  const getAngle = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = knobElRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width  / 2
    const cy = r.top  + r.height / 2
    return Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI)
  }

  const handleKnobDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    knobDragRef.current = { lastAngle: getAngle(e), lastSteps: 0, startY: e.clientY, moved: false }
  }

  const handleKnobMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = knobDragRef.current
    if (!drag) return

    const newAngle = getAngle(e)
    let delta = newAngle - drag.lastAngle
    // Normalise wrap-around (e.g. 179° → -179° should be +2°, not -358°)
    if (delta >  180) delta -= 360
    if (delta < -180) delta += 360
    drag.lastAngle = newAngle
    if (Math.abs(delta) > 1) drag.moved = true

    setKnobAngle(a => a + delta)

    const { selectedParam: sp, screenLocked: lk, standby: sb, paramConfig: pc } = latestKnob.current
    const cfg = sp ? pc[sp] : null
    if (!cfg || lk || sb) return

    drag.lastSteps += delta
    const steps = Math.trunc(drag.lastSteps / DEGREES_PER_STEP)
    if (steps !== 0) {
      drag.lastSteps -= steps * DEGREES_PER_STEP
      cfg.set(prev => {
        const raw = parseFloat((prev + steps * cfg.step).toFixed(cfg.dec ?? 0))
        return clamp(raw, cfg.min, cfg.max)
      })
    }
  }

  const handleKnobUp = () => {
    const wasDrag = knobDragRef.current?.moved ?? false
    knobDragRef.current = null
    if (!wasDrag) setSelectedParam(null)
  }

  return (
    <section className="hamt1-screen" aria-label="Hamilton T1 display">
      <div className="hamt1-device">

        {/* Monitor */}
        <div className="hamt1-monitor">

          {/* Top bar */}
          <div className="hamt1-topbar">
            <div className="hamt1-topbar-left">
              <button
                type="button"
                className="hamt1-mode-btn"
                onClick={() => !screenLocked && setShowModeMenu(m => !m)}
                aria-label="Select ventilation mode"
                aria-disabled={screenLocked}
              >
                <span className="hamt1-mode-label">{modeInfo.label}</span>
                <span className="hamt1-mode-full">{modeInfo.full}</span>
                <span className="hamt1-mode-arrow">▼</span>
              </button>
              <span className="hamt1-patient-group">Adult</span>
            </div>
            <div className={alarmCls}>{alarmText || '\u00A0'}</div>
            <div className="hamt1-topbar-right">
              {audioMuted && <span className="hamt1-audio-off">🔇</span>}
              <span className="hamt1-clock">
                {new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')}
              </span>
            </div>
          </div>

          {/* Mode dropdown */}
          {showModeMenu && (
            <div className="hamt1-mode-menu">
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className={`hamt1-mode-item${m.id === activeMode ? ' hamt1-mode-item--active' : ''}`}
                  onClick={() => { setActiveMode(m.id as ModeId); setShowModeMenu(false) }}
                >
                  <strong>{m.label}</strong>
                  <span>{m.full}</span>
                </button>
              ))}
            </div>
          )}

          <div className="hamt1-status-row" aria-live="polite">
            <span className={`hamt1-status-pill${standby ? ' hamt1-status-pill--standby' : ''}`}>{statusText}</span>
            {audioMuted && <span className="hamt1-status-pill">Audio paused</span>}
            {o2FlushActive && <span className="hamt1-status-pill hamt1-status-pill--o2">O2 flush</span>}
          </div>

          {/* Main area */}
          <div className="hamt1-main">

            {/* Left: MMP values */}
            <aside className="hamt1-left-values" aria-label="Monitored values">
              <div className="hamt1-value-block">
                <strong>{displayValue(ppeak)}</strong>
                <span>Ppeak</span>
                <small>cmH₂O</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{displayValue(pmean)}</strong>
                <span>Pmean</span>
                <small>cmH₂O</small>
              </div>
              <div className="hamt1-value-block hamt1-value-block--yellow">
                <strong>{displayValue(mve.toFixed(1))}</strong>
                <span>MVe</span>
                <small>l/min</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{displayValue(vte)}</strong>
                <span>VTE</span>
                <small>ml</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{displayValue(ftotal)}</strong>
                <span>fTotal</span>
                <small>b/min</small>
              </div>
              <div className="hamt1-value-block hamt1-value-block--dim">
                <strong>{displayValue(fspont)}</strong>
                <span>fSpont</span>
                <small>b/min</small>
              </div>
            </aside>

            {/* Center: waveforms */}
            <div className={`hamt1-wave-stack${standby ? ' hamt1-wave-stack--paused' : ''}`}>
              <div className="hamt1-wave-row hamt1-wave-row--paw">
                <div className="hamt1-wave-head">
                  <span>Paw</span>
                  <small>{standby ? '--' : `${ppeak + 5} cmH₂O`}</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="abp" rate={standby ? 0 : state.vitals.rr} />
                </div>
              </div>
              <div className="hamt1-wave-row hamt1-wave-row--flow">
                <div className="hamt1-wave-head">
                  <span>Flow</span>
                  <small>{standby ? '--' : '80 l/min'}</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="pleth" rate={standby ? 0 : state.vitals.rr} />
                </div>
              </div>
              <div className="hamt1-wave-row hamt1-wave-row--vol">
                <div className="hamt1-wave-head">
                  <span>Vol</span>
                  <small>{standby ? '--' : `${vtSet + 100} ml`}</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="resp" rate={standby ? 0 : state.vitals.rr} />
                </div>
              </div>
            </div>

            {/* Right: set parameters as circular dials */}
            <aside className="hamt1-right-values" aria-label="Set parameters">
              <div className="hamt1-dial-section-hdr">Modes</div>
              {setParams.map((p, i) => {
                const displayLabel = p.label === 'FiO₂' ? 'Oxygen' : p.label
                return (
                  <div
                    key={i}
                    className={`hamt1-dial-wrap${paramConfig[p.label] && !screenLocked && !standby ? ' hamt1-dial-wrap--clickable' : ''}`}
                    onClick={() => handleParamClick(p.label)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedParam === p.label}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleParamClick(p.label) }}
                  >
                    <div className={`hamt1-dial${selectedParam === p.label ? ' hamt1-dial--selected' : ''}`}>
                      <span className="hamt1-dial-value">{p.label === 'FiO₂' ? fio2SetDisplay : p.value}</span>
                      <span className="hamt1-dial-unit">{p.unit}</span>
                    </div>
                    <span className="hamt1-dial-label">{displayLabel}</span>
                  </div>
                )
              })}
              <button type="button" className="hamt1-dial-nav" disabled={screenLocked}>Controls</button>
              <button type="button" className="hamt1-dial-nav" disabled={screenLocked}>Alarms</button>
            </aside>
          </div>

          <div className="hamt1-softkey-panel" aria-live="polite">{tabDetails[activeTab]}</div>

          {/* Bottom softkey bar */}
          <div className="hamt1-bottom-bar">
            {(['monitoring', 'tools', 'events', 'system'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                className={`hamt1-softkey${activeTab === tab ? ' hamt1-softkey--active' : ''}`}
                onClick={() => {
                  if (screenLocked) return
                  setActiveTab(tab)
                }}
                aria-disabled={screenLocked}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Side controls panel */}
        <aside className="hamt1-controls" aria-label="Hamilton T1 controls">
          <button type="button" className="hamt1-power-btn" aria-label="Power">⏻</button>

          <div className="hamt1-ctrl-section">
            <button
              type="button"
              className={`hamt1-ctrl-btn${standby ? ' hamt1-ctrl-btn--active' : ''}`}
              aria-label="Standby"
              title="Standby"
              onClick={handleStandbyToggle}
              aria-disabled={screenLocked}
            >
              <span className="hamt1-ctrl-icon">⏸</span>
              <span className="hamt1-ctrl-lbl">Standby</span>
            </button>
            <button type="button" className={`hamt1-ctrl-btn${audioMuted ? ' hamt1-ctrl-btn--active' : ''}`} aria-label="Audio pause"
              onClick={handleAudioPause}
              aria-disabled={screenLocked}>
              <span className="hamt1-ctrl-icon">{audioMuted ? '🔇' : '🔔'}</span>
              <span className="hamt1-ctrl-lbl">Audio</span>
            </button>
            <button type="button" className={`hamt1-ctrl-btn${inspHoldActive ? ' hamt1-ctrl-btn--active' : ''}`} aria-label="Inspiratory hold" onClick={handleInspHold} aria-disabled={screenLocked || standby}>
              <span className="hamt1-ctrl-icon">↓P</span>
              <span className="hamt1-ctrl-lbl">Insp hold</span>
            </button>
            <button type="button" className={`hamt1-ctrl-btn${expHoldActive ? ' hamt1-ctrl-btn--active' : ''}`} aria-label="Expiratory hold" onClick={handleExpHold} aria-disabled={screenLocked || standby}>
              <span className="hamt1-ctrl-icon">↑P</span>
              <span className="hamt1-ctrl-lbl">Exp hold</span>
            </button>
            <button type="button" className={`hamt1-ctrl-btn${o2FlushActive ? ' hamt1-ctrl-btn--active' : ''}`} aria-label="O2 flush" onClick={handleO2Flush} aria-disabled={screenLocked || standby}>
              <span className="hamt1-ctrl-icon">O₂↑</span>
              <span className="hamt1-ctrl-lbl">O₂ flush</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="Lock screen"
              onClick={() => { setScreenLocked(l => !l); setShowModeMenu(false) }}>
              <span className="hamt1-ctrl-icon">{screenLocked ? '🔒' : '🔓'}</span>
              <span className="hamt1-ctrl-lbl">Lock</span>
            </button>
          </div>

          <div
            ref={knobElRef}
            className="hamt1-knob"
            aria-label={selectedParam ? `Rotary encoder — adjusting ${selectedParam}` : 'Rotary encoder — select a parameter first'}
            style={{ cursor: knobDragRef.current ? 'grabbing' : 'grab' }}
            onPointerDown={handleKnobDown}
            onPointerMove={handleKnobMove}
            onPointerUp={handleKnobUp}
            onPointerCancel={handleKnobUp}
          >
            <div className="hamt1-knob-body" style={{ transform: `rotate(${knobAngle}deg)` }} />
            <div className="hamt1-knob-ring" />
            <div className="hamt1-knob-center" />
          </div>
        </aside>
      </div>
    </section>
  )
}



const LoginScreen = ({ onLogin }: { onLogin: (session: Session) => void }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const account = accounts.find(
      (entry) => entry.username.toLowerCase() === username.trim().toLowerCase() && entry.password === password,
    )

    if (!account) {
      setError('Fel anvandarnamn eller losenord.')
      return
    }

    // Instructors with same username share the same session across devices
    const sessionId = `session:${account.username}`

    onLogin({
      username: account.username,
      role: account.role,
      displayName: account.displayName,
      sessionId,
    })
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="tag">Medical Simulation Studio</p>
        <h1>Logga in</h1>

        <form onSubmit={handleSubmit}>
          <label>
            Anvandarnamn
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Losenord
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" className="primary-button full">
            Logga in
          </button>
        </form>
      </section>
    </main>
  )
}

const ScreenHub = ({
  currentView,
  onOpen,
  role,
}: {
  currentView: ViewId
  onOpen: (view: ViewId) => void
  role: UserRole
}) => (
  <section className="screen-shell">
    <header className="screen-header">
      <h2>Valj skarm</h2>
      <p>Oppna valfri vy i ny flik for separata enheter under simulationen.</p>
    </header>
    <div className="screen-grid">
      {views.map((view) => {
        const blocked = view.requiresInstructor && role !== 'instructor'
        const url = `?view=${view.id}`

        return (
          <article key={view.id} className={`screen-card ${currentView === view.id ? 'active' : ''}`}>
            <p className="device-pill">{view.device}</p>
            <h3>{view.title}</h3>
            <p>{view.subtitle}</p>
            {blocked ? <span className="blocked">Krav: instruktorroll</span> : null}
            <div className="screen-card-actions">
              <button type="button" onClick={() => onOpen(view.id)} disabled={blocked}>
                Öppna
              </button>
              <a href={url} target="_blank" rel="noreferrer">
                Oppna i ny flik
              </a>
            </div>
          </article>
        )
      })}
    </div>
  </section>
)

const AuthenticatedApp = ({
  session,
  onLogout,
}: {
  session: Session
  onLogout: () => void
}) => {
  useKeepScreenAwake()
  const [view, setView] = useState<ViewId>(() => getViewFromUrl())
  const simulation = useSimulationSync()

  useEffect(() => {
    updateViewInUrl(view)
  }, [view])

  const changeView = (nextView: ViewId) => setView(nextView)

  const lockedInstructor = view === 'instructor' && session.role !== 'instructor'

  if (view === 'flow-i') {
    return (
      <>
        <FlowIScreen state={simulation.state} onVentilatorChange={simulation.setVentilatorSettings} />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  if (view === 'x2') {
    return (
      <>
        <X2TransportMonitor
          state={simulation.state}
          triggerNibpReading={simulation.triggerNibpReading}
        />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  if (view === 'intellivue') {
    return (
      <>
        <MonitorScreen
          state={simulation.state}
          title="Intellivue mx450"
          flavor="intellivue"
          triggerNibpReading={simulation.triggerNibpReading}
        />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  if (view === 'x3') {
    return (
      <>
        <X3PatientMonitor state={simulation.state} />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  if (view === 'corpuls3') {
    return (
      <>
        <Corpuls3Screen
          state={simulation.state}
          triggerNibpReading={simulation.triggerNibpReading}
          setRhythm={simulation.setRhythm}
          setAlarmLevel={simulation.setAlarmLevel}
        />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  if (view === 'hamilton-t1') {
    return (
      <>
        <HamiltonT1Screen state={simulation.state} onVentilatorChange={simulation.setVentilatorSettings} />
        <ExitButton onExit={() => changeView('dashboard')} />
      </>
    )
  }

  const isMediaView = view === 'media-xray' || view === 'media-lab' || view === 'media-ultrasound'

  return (
    <main className={`app-shell ${isMediaView ? 'media-app-shell' : ''}`.trim()}>
      {!isMediaView ? (
      <header className="app-header">
        <div>
          <p className="tag">Medical Simulation Studio</p>
          <h1>Simuleringsplattform</h1>
        </div>
        <div className="header-actions">
          <p>
            Inloggad som {session.displayName} ({session.role})
          </p>
          <button type="button" onClick={() => changeView('dashboard')}>
            Skarmval
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Logga ut
          </button>
        </div>
      </header>
      ) : null}

      {view === 'dashboard' ? (
        <ScreenHub currentView={view} onOpen={changeView} role={session.role} />
      ) : null}

      {lockedInstructor ? <p className="access-denied">Instruktorsvy kraver instruktorsinloggning.</p> : null}

      {view === 'instructor' && !lockedInstructor ? (
        <InstructorScreen
          state={simulation.state}
          updateVitals={simulation.updateVitals}
          setRhythm={simulation.setRhythm}
          setParameterVisibility={simulation.setParameterVisibility}
          triggerNibpReading={simulation.triggerNibpReading}
          addMedia={simulation.addMedia}
          removeMedia={simulation.removeMedia}
          setActiveMedia={simulation.setActiveMedia}
          setActiveMediaForChannel={simulation.setActiveMediaForChannel}
          triggerMajorBleeding={simulation.triggerMajorBleeding}
          triggerMtp={simulation.triggerMtp}
          giveCalcium={simulation.giveCalcium}
          resetBloodGasGenerator={simulation.resetBloodGasGenerator}
          setBloodGasSampleType={simulation.setBloodGasSampleType}
          addSound={simulation.addSound}
          removeSound={simulation.removeSound}
          setActiveSound={simulation.setActiveSound}
          setVentilated={simulation.setVentilated}
        />
      ) : null}

      {view === 'media-xray' ? <MediaScreen state={simulation.state} channel="xray" /> : null}
      {view === 'media-lab' ? <MediaScreen state={simulation.state} channel="lab" /> : null}
      {view === 'media-ultrasound' ? <MediaScreen state={simulation.state} channel="ultrasound" /> : null}

      {isMediaView ? (
        <ExitButton onExit={() => changeView('dashboard')} />
      ) : null}
    </main>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)

  const handleLogin = (nextSession: Session) => {
    setSession(nextSession)
  }

  const handleLogout = () => {
    setSession(null)
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return <AuthenticatedApp session={session} onLogout={handleLogout} />
}

export default App
