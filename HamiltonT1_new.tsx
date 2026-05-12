const HamiltonT1Screen = ({ state }: { state: SimulationState }) => {
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
  const [audioMuted, setAudioMuted] = useState(false)
  const [screenLocked, setScreenLocked] = useState(false)
  const [activeTab, setActiveTab] = useState<'monitoring' | 'tools' | 'events' | 'system'>('monitoring')
  const [showModeMenu, setShowModeMenu] = useState(false)

  const modeInfo = MODES.find(m => m.id === activeMode) ?? MODES[0]

  // ── Derived MMP (Main Monitoring Parameters, ch.8) ───────────────────────────
  const ppeak   = Math.round(clamp(12 + state.vitals.rr * 0.6 + (state.vitals.etco2 - 28) * 0.1, 8, 50))
  const pmean   = Math.round(clamp(ppeak * 0.42, 3, 22))
  const peepMeas = Math.round(clamp(3 + state.vitals.rr * 0.12, 3, 14))
  const vte     = Math.round(clamp(420 + state.vitals.rr * 4 + (state.vitals.etco2 - 28) * 6, 150, 900))
  const mve     = parseFloat(((vte * state.vitals.rr) / 1000).toFixed(1))
  const ftotal  = state.vitals.rr
  const fspont  = (activeMode === 'spont' || activeMode === 'niv' || activeMode === 'niv-st')
    ? state.vitals.rr : Math.round(state.vitals.rr * 0.25)
  const fio2Meas = Math.round(clamp(40 + (100 - state.vitals.spo2) * 2.8, 21, 100))

  // ── Set parameters ───────────────────────────────────────────────────────────
  const vtSet    = 500
  const peepSet  = 5
  const rateSet  = Math.max(10, Math.round(ftotal * 0.8))
  const pInspSet = Math.round(clamp(ppeak - peepSet + 2, 10, 40))
  const psSet    = 12
  const fio2Set  = 50
  const tiSet    = 1.0
  const mvolPct  = 100

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
        { label: 'Phigh', value: Math.round(pInspSet + peepSet), unit: 'cmH₂O' },
        { label: 'Thigh', value: '1.5', unit: 's' },
        { label: 'PEEP', value: peepSet, unit: 'cmH₂O' },
        { label: 'Rate', value: rateSet, unit: 'b/min' },
      ]
      case 'aprv': return [
        { label: 'Phigh', value: Math.round(pInspSet + peepSet), unit: 'cmH₂O' },
        { label: 'Plow', value: 0, unit: 'cmH₂O' },
        { label: 'Thigh', value: '4.0', unit: 's' },
        { label: 'Tlow', value: '0.6', unit: 's' },
      ]
      case 'spont': return [
        { label: 'PS', value: psSet, unit: 'cmH₂O' },
        { label: 'PEEP/CPAP', value: peepSet, unit: 'cmH₂O' },
        { label: 'FiO₂', value: fio2Set, unit: '%' },
        { label: 'Trigger', value: '2', unit: 'l/min' },
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

  const alarmHigh = state.alarmLevel === 'high'
  const alarmMed  = state.alarmLevel === 'medium'
  const alarmText = alarmHigh ? 'High-priority alarm' : alarmMed ? 'Medium-priority alarm' : ''
  const alarmCls  = alarmHigh
    ? 'hamt1-alarm hamt1-alarm--high'
    : alarmMed
      ? 'hamt1-alarm hamt1-alarm--med'
      : 'hamt1-alarm hamt1-alarm--none'

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

          {/* Main area */}
          <div className="hamt1-main">

            {/* Left: MMP values */}
            <aside className="hamt1-left-values" aria-label="Monitored values">
              <div className="hamt1-value-block">
                <strong>{ppeak}</strong>
                <span>Ppeak</span>
                <small>cmH₂O</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{pmean}</strong>
                <span>Pmean</span>
                <small>cmH₂O</small>
              </div>
              <div className="hamt1-value-block hamt1-value-block--yellow">
                <strong>{mve.toFixed(1)}</strong>
                <span>MVe</span>
                <small>l/min</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{vte}</strong>
                <span>VTE</span>
                <small>ml</small>
              </div>
              <div className="hamt1-value-block">
                <strong>{ftotal}</strong>
                <span>fTotal</span>
                <small>b/min</small>
              </div>
              <div className="hamt1-value-block hamt1-value-block--dim">
                <strong>{fspont}</strong>
                <span>fSpont</span>
                <small>b/min</small>
              </div>
            </aside>

            {/* Center: waveforms */}
            <div className="hamt1-wave-stack">
              <div className="hamt1-wave-row hamt1-wave-row--paw">
                <div className="hamt1-wave-head">
                  <span>Paw</span>
                  <small>{ppeak + 5} cmH₂O</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="abp" rate={state.vitals.rr} />
                </div>
              </div>
              <div className="hamt1-wave-row hamt1-wave-row--flow">
                <div className="hamt1-wave-head">
                  <span>Flow</span>
                  <small>80 l/min</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="pleth" rate={state.vitals.rr} />
                </div>
              </div>
              <div className="hamt1-wave-row hamt1-wave-row--vol">
                <div className="hamt1-wave-head">
                  <span>Vol</span>
                  <small>{vtSet + 100} ml</small>
                </div>
                <div className="hamt1-wave-wrap">
                  <Waveform rhythm={state.rhythm} alarmLevel={state.alarmLevel} compact variant="resp" rate={state.vitals.rr} />
                </div>
              </div>
            </div>

            {/* Right: set parameters */}
            <aside className="hamt1-right-values" aria-label="Set parameters">
              <div className="hamt1-set-header">Set parameters</div>
              {setParams.map((p, i) => (
                <div key={i} className="hamt1-set-param">
                  <span className="hamt1-set-label">{p.label}</span>
                  <span className="hamt1-set-value">{p.value}</span>
                  <span className="hamt1-set-unit">{p.unit}</span>
                </div>
              ))}
              <div className="hamt1-meas-o2">
                <span>FiO₂ meas</span>
                <strong>{fio2Meas}</strong>
                <span>%</span>
              </div>
              <div className="hamt1-peep-meas">
                <span>PEEP meas</span>
                <strong>{peepMeas}</strong>
                <span>cmH₂O</span>
              </div>
            </aside>
          </div>

          {/* Bottom softkey bar */}
          <div className="hamt1-bottom-bar">
            {(['monitoring', 'tools', 'events', 'system'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                className={`hamt1-softkey${activeTab === tab ? ' hamt1-softkey--active' : ''}`}
                onClick={() => setActiveTab(tab)}
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
            <button type="button" className="hamt1-ctrl-btn" aria-label="Standby" title="Standby">
              <span className="hamt1-ctrl-icon">⏸</span>
              <span className="hamt1-ctrl-lbl">Standby</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="Audio pause"
              onClick={() => setAudioMuted(m => !m)}>
              <span className="hamt1-ctrl-icon">{audioMuted ? '🔇' : '🔔'}</span>
              <span className="hamt1-ctrl-lbl">Audio</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="Inspiratory hold">
              <span className="hamt1-ctrl-icon">↓P</span>
              <span className="hamt1-ctrl-lbl">Insp hold</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="Expiratory hold">
              <span className="hamt1-ctrl-icon">↑P</span>
              <span className="hamt1-ctrl-lbl">Exp hold</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="O2 flush">
              <span className="hamt1-ctrl-icon">O₂↑</span>
              <span className="hamt1-ctrl-lbl">O₂ flush</span>
            </button>
            <button type="button" className="hamt1-ctrl-btn" aria-label="Lock screen"
              onClick={() => setScreenLocked(l => !l)}>
              <span className="hamt1-ctrl-icon">{screenLocked ? '🔒' : '🔓'}</span>
              <span className="hamt1-ctrl-lbl">Lock</span>
            </button>
          </div>

          <div className="hamt1-knob" aria-label="Rotary encoder" aria-hidden="true" />
        </aside>
      </div>
    </section>
  )
}
