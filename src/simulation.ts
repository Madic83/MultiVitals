import { useEffect, useId, useMemo, useState } from 'react'

export type RhythmPreset = 'sinus' | 'afib' | 'flutter' | 'svt' | 'vtach' | 'vfib' | 'asystole' | 'pea'
  | 'stemi_ant' | 'stemi_inf' | 'stemi_lat' | 'lbbb' | 'rbbb' | 'avblock3' | 'wpw'
export type AlarmLevel = 'normal' | 'warning' | 'critical'
export type MediaType = 'image' | 'video'
export type MediaChannel = 'xray' | 'lab' | 'ultrasound'
export type MonitorParamKey = 'hr' | 'spo2' | 'rr' | 'abp' | 'temp' | 'etco2'
export type BloodGasSampleType = 'arterial' | 'venous'

export interface BloodGasValues {
  pH: number
  pCO2: number
  pO2: number
  sO2: number
  SBEc: number
  Hb: number
  cK: number
  cNa: number
  cCa: number
  cCL: number
  cGlu: number
  cLac: number
}

export interface BloodGasControl {
  majorBleedLevel: number
  mtpCycles: number
  calciumDoses: number
  lastEvent: 'none' | 'major-bleeding' | 'mtp' | 'calcium'
  lastEventAt: number | null
}

export interface VentilatorSettings {
  rr: number
  fio2: number
  peep: number
  vt: number
  weight: number
}

export interface Vitals {
  hr: number
  spo2: number
  rr: number
  nibpSys: number
  nibpDia: number
  map: number
  temp: number
  etco2: number
}

export interface MediaItem {
  id: string
  title: string
  type: MediaType
  url: string
}

export interface SoundItem {
  id: string
  title: string
  url: string
}

export interface SimulationState {
  vitals: Vitals
  parameterVisibility: Record<MonitorParamKey, boolean>
  nibpReading: {
    sys: number
    dia: number
    map: number
    measuredAt: number
  } | null
  rhythm: RhythmPreset
  alarmLevel: AlarmLevel
  mediaLibrary: MediaItem[]
  activeMediaId: string | null
  activeMediaByChannel: Record<MediaChannel, string | null>
  bloodGas: BloodGasValues
  bloodGasSampleType: BloodGasSampleType
  bloodGasControl: BloodGasControl
  ventilated: boolean
  ventilatorSettings: VentilatorSettings
  soundLibrary: SoundItem[]
  activeSoundId: string | null
  updatedAt: number
}

export const ALARM_LIMITS = {
  hr: { low: 50, high: 120 },
  spo2: { low: 90, high: 100 },
  abpSys: { low: 90, high: 160 },
  etco2: { low: 30, high: 50 },
} as const

const RHYTHM_MIN_HR: Partial<Record<RhythmPreset, number>> = {
  flutter: 150,
  svt: 180,
  vtach: 190,
  vfib: 220,
}

const RHYTHM_FIXED_HR: Partial<Record<RhythmPreset, number>> = {
  afib: 120,
  asystole: 0,
  pea: 70,
  avblock3: 35,
}

const RHYTHM_ZERO_BP: Partial<Record<RhythmPreset, true>> = {
  asystole: true,
  pea: true,
}

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const defaultVentilatorSettings: VentilatorSettings = {
  rr: 14,
  fio2: 50,
  peep: 5,
  vt: 500,
  weight: 70,
}

const defaultBloodGasControl: BloodGasControl = {
  majorBleedLevel: 0,
  mtpCycles: 0,
  calciumDoses: 0,
  lastEvent: 'none',
  lastEventAt: null,
}

const computeBloodGas = (state: Pick<SimulationState, 'vitals' | 'rhythm' | 'bloodGasControl' | 'bloodGasSampleType' | 'ventilated' | 'ventilatorSettings'>): BloodGasValues => {
  const { vitals, rhythm, bloodGasControl, bloodGasSampleType } = state
  const ventilated = state.ventilated ?? false
  const ventSettings = state.ventilatorSettings ?? defaultVentilatorSettings
  const weight = ventSettings.weight ?? 70
  const bleed = bloodGasControl.majorBleedLevel
  const mtp = bloodGasControl.mtpCycles
  const calcium = bloodGasControl.calciumDoses

  const rhythmShock = RHYTHM_ZERO_BP[rhythm] ? 1.25 : 0
  const pressureShock = Math.max(0, (92 - vitals.nibpSys) / 92)
  const oxygenStress = Math.max(0, (94 - vitals.spo2) / 18)
  const tachyStress = Math.max(0, (vitals.hr - 120) / 120)
  const shockIndex = rhythmShock + pressureShock + oxygenStress + tachyStress

  const isVenous = bloodGasSampleType === 'venous'
  const venousPCO2Offset = isVenous ? 6 : 0
  const venousPO2Offset = isVenous ? -52 : 0
  const venousSO2Offset = isVenous ? -24 : 0
  const venousPHOffset = isVenous ? -0.03 : 0
  const venousLactateOffset = isVenous ? 0.15 : 0

  // Ventilator effects
  // FiO2: baseline 21% (room air). Each % above 21 adds ~0.55 mmHg to alveolar pO2 (simplified PAO2 formula)
  const fio2Boost = ventilated ? clampNumber((ventSettings.fio2 - 21) * 0.55, 0, 280) : 0
  // PEEP: each cmH2O above 0 adds ~1.5 mmHg pO2 (recruitment effect, diminishes at high values)
  const peepBoost = ventilated ? clampNumber(ventSettings.peep * 1.5, 0, 30) : 0
  // Minute ventilation model: pCO2 scales with alveolar MV relative to patient's normal
  // Dead space ≈ 2 ml/kg. Normal VT = 7 ml/kg → normal alveolar VT = 5 ml/kg.
  // Normal alveolar MV = 14 × weight × 5 (ml/min).
  const deadSpace = weight * 2
  const normalAlvMV = 14 * weight * 5
  const vt = ventSettings.vt ?? 500
  const actualAlvVT = Math.max(vt - deadSpace, 10)
  const actualAlvMV = ventSettings.rr * actualAlvVT
  // ventRREffect: mmHg pCO2 deviation from normoventilation (positive = hypoventilation/hypercapnia)
  const ventRREffect = ventilated ? clampNumber((normalAlvMV / actualAlvMV - 1) * 12.6, -25, 40) : 0

  const pCO2mmHg = clampNumber(vitals.etco2 + 4 + bleed * 1.4 + shockIndex * 2.2 - mtp * 0.6 + venousPCO2Offset + ventRREffect, 15, 95)
  const SBEc = clampNumber(-bleed * 2.8 - shockIndex * 2.1 + mtp * 0.9 + calcium * 0.7, -20, 10)

  // ventPCO2delta: pCO2 shift in mmHg caused by ventilator RR setting (positive = hypoventilation)
  const ventPCO2delta = ventilated ? ventRREffect : 0
  // Lactate: hypercapnia impairs cellular metabolism → mild rise
  const ventLactateEffect = ventPCO2delta > 0 ? ventPCO2delta * 0.02 : 0
  const lactate = clampNumber(1.1 + bleed * 1.2 + shockIndex * 1.8 - mtp * 0.45 - calcium * 0.15 + venousLactateOffset + ventLactateEffect, 0.5, 20)

  const pH = clampNumber(7.40 - (pCO2mmHg - 40) * 0.004 + SBEc * 0.012 - (lactate - 1.1) * 0.01 + venousPHOffset, 6.8, 7.65)
  const pCO2 = pCO2mmHg * 0.13332
  // pO2: raised by FiO2 and PEEP when ventilated
  const pO2base = clampNumber(95 + (vitals.spo2 - 97) * 2.3 - bleed * 4 - shockIndex * 8 + mtp * 2, 20, 320)
  const pO2 = clampNumber((pO2base + fio2Boost + peepBoost + venousPO2Offset) * 0.13332, 2.7, 80)
  // sO2/SpO2: FiO2 and PEEP modestly improve saturation (ceiling at 100)
  const spo2Boost = ventilated ? clampNumber((ventSettings.fio2 - 21) * 0.05 + ventSettings.peep * 0.2, 0, 6) : 0
  const sO2 = clampNumber(vitals.spo2 - bleed + mtp * 0.4 + spo2Boost + venousSO2Offset, 35, 100)

  const Hb = clampNumber(145 - bleed * 22 + mtp * 14, 45, 190)

  // K+: H+/K+ exchange – acidosis (↑CO2) raises K+, alkalosis lowers it.
  // Rule: ~0.1 mEq/L per 10 mmHg ΔpCO2 (acute respiratory).
  const ventKEffect = ventPCO2delta * 0.01

  // Ionized Ca2+: alkalosis binds more Ca2+ to albumin → ↓ ionized Ca2+.
  // ~0.02 mmol/L per 10 mmHg ΔpCO2 (opposite direction).
  const ventCaEffect = ventPCO2delta * 0.002

  // Cl-: acute respiratory alkalosis → HCO3- falls → Cl- compensates upward.
  // ~2–3 mEq/L per 10 mmHg pCO2 drop.
  const ventClEffect = -ventPCO2delta * 0.25

  const cK = clampNumber(4.0 + bleed * 0.25 + mtp * 0.3 - calcium * 0.05 + (vitals.nibpSys < 80 ? 0.25 : 0) + ventKEffect, 2.2, 8.5)
  const cNa = clampNumber(140 - bleed * 1.8 + mtp * 0.4, 124, 155)
  const cCa = clampNumber(1.20 - bleed * 0.05 - mtp * 0.12 + calcium * 0.18 + ventCaEffect, 0.55, 1.6)
  const cCL = clampNumber(104 + bleed * 1.2 + mtp * 0.6 + ventClEffect, 90, 125)
  const cGlu = clampNumber(5.6 + shockIndex * 1.5 + bleed * 0.5, 2.5, 22)

  return {
    pH: roundTo(pH, 2),
    pCO2: roundTo(pCO2, 2),
    pO2: roundTo(pO2, 2),
    sO2: roundTo(sO2, 1),
    SBEc: roundTo(SBEc, 1),
    Hb: roundTo(Hb, 0),
    cK: roundTo(cK, 2),
    cNa: roundTo(cNa, 0),
    cCa: roundTo(cCa, 2),
    cCL: roundTo(cCL, 0),
    cGlu: roundTo(cGlu, 1),
    cLac: roundTo(lactate, 2),
  }
}

const SINUS_TARGET_HR = 86
const NORMAL_BP_SYS = 122
const NORMAL_BP_DIA = 78

const defaultVitals: Vitals = {
  hr: 86,
  spo2: 98,
  rr: 14,
  nibpSys: 122,
  nibpDia: 78,
  map: 93,
  temp: 37.0,
  etco2: 34,
}

const defaultBloodGas = computeBloodGas({
  vitals: defaultVitals,
  rhythm: 'sinus',
  bloodGasSampleType: 'arterial',
  bloodGasControl: defaultBloodGasControl,
  ventilated: false,
  ventilatorSettings: defaultVentilatorSettings,
})

const STORAGE_KEY = 'med-sim-state-v1'
const CHANNEL_NAME = 'med-sim-sync'

const defaultState: SimulationState = {
  vitals: defaultVitals,
  parameterVisibility: {
    hr: false,
    spo2: false,
    rr: false,
    abp: false,
    temp: false,
    etco2: false,
  },
  nibpReading: null,
  rhythm: 'sinus',
  alarmLevel: 'normal',
  mediaLibrary: [],
  activeMediaId: null,
  activeMediaByChannel: {
    xray: null,
    lab: null,
    ultrasound: null,
  },
  bloodGas: defaultBloodGas,
  bloodGasSampleType: 'arterial',
  bloodGasControl: defaultBloodGasControl,
  ventilated: false,
  ventilatorSettings: defaultVentilatorSettings,
  soundLibrary: [],
  activeSoundId: null,
  updatedAt: Date.now(),
}

const normalizeState = (incoming: Partial<SimulationState>): SimulationState => {
  const vitals = {
    ...defaultState.vitals,
    ...(incoming.vitals ?? {}),
  }

  const bloodGasControl: BloodGasControl = {
    ...defaultBloodGasControl,
    ...(incoming.bloodGasControl ?? {}),
  }

  const bloodGasSampleType: BloodGasSampleType = incoming.bloodGasSampleType === 'venous' ? 'venous' : 'arterial'

  const merged: SimulationState = {
    ...defaultState,
    ...incoming,
    vitals,
    parameterVisibility: {
      ...defaultState.parameterVisibility,
      ...(incoming.parameterVisibility ?? {}),
    },
    nibpReading: incoming.nibpReading ?? null,
    mediaLibrary: incoming.mediaLibrary ?? [],
    activeMediaId: incoming.activeMediaId ?? null,
    activeMediaByChannel: {
      ...defaultState.activeMediaByChannel,
      ...(incoming.activeMediaByChannel ?? {}),
    },
    bloodGasControl,
    bloodGasSampleType,
    ventilated: incoming.ventilated ?? false,
    ventilatorSettings: {
      ...defaultVentilatorSettings,
      ...(incoming.ventilatorSettings ?? {}),
    },
    soundLibrary: incoming.soundLibrary ?? [],
    activeSoundId: incoming.activeSoundId ?? null,
    alarmLevel: getAlarmLevelForVitals(vitals),
    updatedAt: typeof incoming.updatedAt === 'number' ? incoming.updatedAt : Date.now(),
  }

  return {
    ...merged,
    bloodGas: computeBloodGas(merged),
  }
}

const parseStoredState = (): SimulationState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultState
    }

    const parsed = JSON.parse(raw) as Partial<SimulationState>
    return normalizeState(parsed)
  } catch {
    return defaultState
  }
}

const recalculateMap = (sys: number, dia: number): number => Math.round((sys + 2 * dia) / 3)

const getAlarmLevelForVitals = (vitals: Vitals): AlarmLevel => {
  const hrOutOfRange = vitals.hr < ALARM_LIMITS.hr.low || vitals.hr > ALARM_LIMITS.hr.high
  const spo2OutOfRange = vitals.spo2 < ALARM_LIMITS.spo2.low || vitals.spo2 > ALARM_LIMITS.spo2.high
  const bpOutOfRange = vitals.nibpSys < ALARM_LIMITS.abpSys.low || vitals.nibpSys > ALARM_LIMITS.abpSys.high

  return hrOutOfRange || spo2OutOfRange || bpOutOfRange ? 'warning' : 'normal'
}

interface ChannelPayload {
  source: string
  state: SimulationState
}

export const useSimulationSync = () => {
  const sourceId = useId()
  const channel = useMemo<BroadcastChannel | null>(() => {
    if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
      return null
    }
    return new BroadcastChannel(CHANNEL_NAME)
  }, [])
  const [state, setState] = useState<SimulationState>(() => parseStoredState())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Some embedded browsers disallow storage access; continue without persistence.
    }
    if (channel) {
      const message: ChannelPayload = { source: sourceId, state }
      channel.postMessage(message)
    }
  }, [channel, sourceId, state])

  useEffect(() => {
    const onMessage = (event: MessageEvent<ChannelPayload>) => {
      const payload = event.data
      if (!payload || payload.source === sourceId) {
        return
      }
      setState(normalizeState(payload.state as Partial<SimulationState>))
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) {
        return
      }
      try {
        const incoming = JSON.parse(event.newValue) as Partial<SimulationState>
        setState(normalizeState(incoming))
      } catch {
        // Ignore malformed sync payloads from external writes.
      }
    }

    if (channel) {
      channel.addEventListener('message', onMessage)
    }
    window.addEventListener('storage', onStorage)

    return () => {
      if (channel) {
        channel.removeEventListener('message', onMessage)
      }
      window.removeEventListener('storage', onStorage)
      if (channel) {
        channel.close()
      }
    }
  }, [channel, sourceId])

  const updateVitals = (patch: Partial<Vitals>) => {
    setState((prev) => {
      const nextSys = patch.nibpSys ?? prev.vitals.nibpSys
      const requestedDia = patch.nibpDia ?? prev.vitals.nibpDia
      const nextDia = requestedDia >= nextSys ? Math.max(20, nextSys - 10) : requestedDia
      const nextVitals = {
        ...prev.vitals,
        ...patch,
        nibpSys: nextSys,
        nibpDia: nextDia,
        map: patch.map ?? recalculateMap(nextSys, nextDia),
      }

      const nextState: SimulationState = {
        ...prev,
        vitals: nextVitals,
        alarmLevel: getAlarmLevelForVitals(nextVitals),
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const setRhythm = (rhythm: RhythmPreset) => {
    setState((prev) => {
      const fixedHr = RHYTHM_FIXED_HR[rhythm]
      const minimumHr = RHYTHM_MIN_HR[rhythm]
      const shouldZeroBp = RHYTHM_ZERO_BP[rhythm] === true
      const wasZeroBpRhythm = RHYTHM_ZERO_BP[prev.rhythm] === true
      const shouldRestoreBp = wasZeroBpRhythm && !shouldZeroBp
      const nextVitals = rhythm === 'sinus'
        ? {
            ...prev.vitals,
            hr: prev.rhythm === 'sinus' ? prev.vitals.hr : SINUS_TARGET_HR,
          }
        : fixedHr !== undefined
          ? {
              ...prev.vitals,
              hr: fixedHr,
            }
        : minimumHr === undefined
          ? prev.vitals
          : {
              ...prev.vitals,
              hr: Math.max(prev.vitals.hr, minimumHr),
            }

      const collapsedVitals = shouldZeroBp
        ? {
            ...nextVitals,
            nibpSys: 0,
            nibpDia: 0,
            map: 0,
          }
        : shouldRestoreBp
          ? {
              ...nextVitals,
              nibpSys: NORMAL_BP_SYS,
              nibpDia: NORMAL_BP_DIA,
              map: recalculateMap(NORMAL_BP_SYS, NORMAL_BP_DIA),
            }
        : nextVitals

      const nextNibpReading = shouldZeroBp
        ? {
            sys: 0,
            dia: 0,
            map: 0,
            measuredAt: Date.now(),
          }
        : shouldRestoreBp
          ? null
        : prev.nibpReading

      const nextState: SimulationState = {
        ...prev,
        rhythm,
        vitals: collapsedVitals,
        nibpReading: nextNibpReading,
        alarmLevel: getAlarmLevelForVitals(collapsedVitals),
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const setBloodGasSampleType = (bloodGasSampleType: BloodGasSampleType) => {
    setState((prev) => {
      if (prev.bloodGasSampleType === bloodGasSampleType) {
        return prev
      }

      const nextState: SimulationState = {
        ...prev,
        bloodGasSampleType,
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const setAlarmLevel = (alarmLevel: AlarmLevel) => {
    setState((prev) => ({ ...prev, alarmLevel, updatedAt: Date.now() }))
  }

  const setParameterVisibility = (parameter: MonitorParamKey, isVisible: boolean) => {
    setState((prev) => ({
      ...prev,
      parameterVisibility: {
        ...prev.parameterVisibility,
        [parameter]: isVisible,
      },
      updatedAt: Date.now(),
    }))
  }

  const triggerNibpReading = () => {
    setState((prev) => ({
      ...prev,
      nibpReading: {
        sys: prev.vitals.nibpSys,
        dia: prev.vitals.nibpDia,
        map: prev.vitals.map,
        measuredAt: Date.now(),
      },
      updatedAt: Date.now(),
    }))
  }

  const triggerMajorBleeding = () => {
    setState((prev) => {
      const nextState: SimulationState = {
        ...prev,
        bloodGasControl: {
          ...prev.bloodGasControl,
          majorBleedLevel: clampNumber(prev.bloodGasControl.majorBleedLevel + 1, 0, 4),
          lastEvent: 'major-bleeding',
          lastEventAt: Date.now(),
        },
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const triggerMtp = () => {
    setState((prev) => {
      const nextState: SimulationState = {
        ...prev,
        bloodGasControl: {
          ...prev.bloodGasControl,
          mtpCycles: prev.bloodGasControl.mtpCycles + 1,
          lastEvent: 'mtp',
          lastEventAt: Date.now(),
        },
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const giveCalcium = () => {
    setState((prev) => {
      const nextState: SimulationState = {
        ...prev,
        bloodGasControl: {
          ...prev.bloodGasControl,
          calciumDoses: prev.bloodGasControl.calciumDoses + 1,
          lastEvent: 'calcium',
          lastEventAt: Date.now(),
        },
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const resetBloodGasGenerator = () => {
    setState((prev) => {
      const nextState: SimulationState = {
        ...prev,
        vitals: defaultVitals,
        rhythm: 'sinus',
        bloodGasControl: defaultBloodGasControl,
        nibpReading: null,
        alarmLevel: 'normal',
        updatedAt: Date.now(),
      }

      return {
        ...nextState,
        bloodGas: computeBloodGas(nextState),
      }
    })
  }

  const addMedia = (item: Omit<MediaItem, 'id'>): string => {
    const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setState((prev) => ({
      ...prev,
      mediaLibrary: [...prev.mediaLibrary, { ...item, id }],
      activeMediaId: prev.activeMediaId ?? id,
      updatedAt: Date.now(),
    }))
    return id
  }

  const removeMedia = (id: string) => {
    setState((prev) => {
      const mediaLibrary = prev.mediaLibrary.filter((entry) => entry.id !== id)
      const activeMediaId =
        prev.activeMediaId === id ? null : prev.activeMediaId
      const activeMediaByChannel: Record<MediaChannel, string | null> = {
        xray: prev.activeMediaByChannel.xray === id ? null : prev.activeMediaByChannel.xray,
        lab: prev.activeMediaByChannel.lab === id ? null : prev.activeMediaByChannel.lab,
        ultrasound: prev.activeMediaByChannel.ultrasound === id ? null : prev.activeMediaByChannel.ultrasound,
      }

      return {
        ...prev,
        mediaLibrary,
        activeMediaId,
        activeMediaByChannel,
        updatedAt: Date.now(),
      }
    })
  }

  const setActiveMedia = (id: string) => {
    setState((prev) => ({ ...prev, activeMediaId: id, updatedAt: Date.now() }))
  }

  const setActiveMediaForChannel = (channel: MediaChannel, id: string | null) => {
    setState((prev) => ({
      ...prev,
      activeMediaId: id ?? prev.activeMediaId,
      activeMediaByChannel: {
        ...prev.activeMediaByChannel,
        [channel]: id,
      },
      updatedAt: Date.now(),
    }))
  }

  const clearActiveMedia = () => {
    setState((prev) => ({
      ...prev,
      activeMediaId: null,
      activeMediaByChannel: {
        xray: null,
        lab: null,
        ultrasound: null,
      },
      updatedAt: Date.now(),
    }))
  }

  const addSound = (item: Omit<SoundItem, 'id'>) => {
    const id = `sound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setState((prev) => ({
      ...prev,
      soundLibrary: [...prev.soundLibrary, { ...item, id }],
      activeSoundId: prev.activeSoundId ?? id,
      updatedAt: Date.now(),
    }))
  }

  const removeSound = (id: string) => {
    setState((prev) => {
      const soundLibrary = prev.soundLibrary.filter((entry) => entry.id !== id)
      const activeSoundId =
        prev.activeSoundId === id ? (soundLibrary.length ? soundLibrary[0].id : null) : prev.activeSoundId

      return {
        ...prev,
        soundLibrary,
        activeSoundId,
        updatedAt: Date.now(),
      }
    })
  }

  const setActiveSound = (id: string) => {
    setState((prev) => ({ ...prev, activeSoundId: id, updatedAt: Date.now() }))
  }

  const setVentilated = (ventilated: boolean) => {
    setState((prev) => {
      const ventilatorSettings: VentilatorSettings = prev.ventilatorSettings ?? defaultVentilatorSettings
      const nextState: SimulationState = { ...prev, ventilated, ventilatorSettings, updatedAt: Date.now() }
      if (ventilated) {
        const nextVitals = { ...nextState.vitals, rr: ventilatorSettings.rr }
        return {
          ...nextState,
          vitals: nextVitals,
          bloodGas: computeBloodGas({ ...nextState, vitals: nextVitals }),
        }
      }
      return { ...nextState, bloodGas: computeBloodGas(nextState) }
    })
  }

  const setVentilatorSettings = (settings: Partial<VentilatorSettings>) => {
    setState((prev) => {
      const ventilatorSettings: VentilatorSettings = { ...(prev.ventilatorSettings ?? defaultVentilatorSettings), ...settings }
      const nextState: SimulationState = { ...prev, ventilatorSettings, updatedAt: Date.now() }
      if (prev.ventilated && settings.rr !== undefined) {
        const nextVitals = { ...nextState.vitals, rr: settings.rr }
        return {
          ...nextState,
          vitals: nextVitals,
          bloodGas: computeBloodGas({ ...nextState, vitals: nextVitals }),
        }
      }
      return { ...nextState, bloodGas: computeBloodGas(nextState) }
    })
  }

  return {
    state,
    updateVitals,
    setRhythm,
    setBloodGasSampleType,
    setAlarmLevel,
    setParameterVisibility,
    triggerNibpReading,
    addMedia,
    removeMedia,
    setActiveMedia,
    setActiveMediaForChannel,
    clearActiveMedia,
    triggerMajorBleeding,
    triggerMtp,
    giveCalcium,
    resetBloodGasGenerator,
    addSound,
    removeSound,
    setActiveSound,
    setVentilated,
    setVentilatorSettings,
  }
}
