import { useEffect, useState } from "react";
import { audio, supportsHaptics, type AudioEngine, type AudioPrefs } from "../audio/engine.js";
import { sfxTap } from "../audio/sounds.js";
import { DIAG_LIGADO } from "../audio/diagnostico.js";
import { BotaoDiagnosticoDeAudio, aoAbrirPainelDeSom } from "./DiagnosticoDeAudio.js";

/**
 * O liga/desliga de uma chave do painel, DENTRO do toque. Exportado para o teste do motor.
 *
 * Religar Música ou Efeitos troca o contexto de áudio por um novo (`religar`): no Android do vc1 o
 * som sumiu e desligar/religar não o trazia de volta. Desligar só desliga — nada é recriado.
 */
export function alternarPreferencia(motor: AudioEngine, k: keyof AudioPrefs, tocar: () => void = sfxTap): void {
  const antes = motor.get();
  motor.unlock();
  motor.set({ [k]: !antes[k] } as Partial<AudioPrefs>);
  if ((k === "music" || k === "sfx") && !antes[k]) motor.religar();
  if (k !== "music" || !antes.music) tocar();
}

/** Lê e reage às preferências de áudio (compartilhadas por toda a app). */
export function useAudioPrefs(): AudioPrefs {
  const [prefs, setPrefs] = useState<AudioPrefs>(() => audio.get());
  useEffect(() => audio.subscribe(setPrefs), []);
  return prefs;
}

/** Botão compacto que abre o painel — vive no topo da Mesa e na Home. */
export function AudioButton({ onOpen }: { onOpen: () => void }) {
  const prefs = useAudioPrefs();
  const mudo = !prefs.music && !prefs.sfx;
  return (
    <button
      className="audiobtn"
      // Abrir o painel REATIVA o som (contexto novo, dentro do toque): é o gesto natural de quem
      // perdeu o som, e há mortes da saída do Android que o motor não enxerga (2º QA, 03/11/2026).
      // APK DEBUG (rodada 5): antes do reparo, o diagnóstico guarda o motor como estava.
      onClick={() => { if (DIAG_LIGADO) aoAbrirPainelDeSom(); audio.reativar(); sfxTap(); onOpen(); }}
      aria-label="Som e vibração"
      title="Som e vibração"
    >
      {mudo ? "🔇" : "🔊"}
    </button>
  );
}

/**
 * Controles SEPARADOS de Música / Efeitos / Haptics — todos desligáveis, como manda o
 * Design System. As escolhas ficam salvas no aparelho.
 */
export function AudioPanel({ onClose }: { onClose: () => void }) {
  const prefs = useAudioPrefs();
  const toggle = (k: keyof AudioPrefs) => () => alternarPreferencia(audio, k);
  return (
    <div className="ov" onClick={onClose}>
      <div className="ovcard" onClick={(e) => e.stopPropagation()}>
        <h2>Som e vibração</h2>
        <div className="sub">Tudo pode ser desligado. Fica salvo neste aparelho.</div>

        <Row label="Música" hint="Ambiente da mesa" on={prefs.music} onToggle={toggle("music")}>
          <Slider value={prefs.musicVol} disabled={!prefs.music} onChange={(v) => audio.set({ musicVol: v })} label="Volume da música" />
        </Row>
        <Row label="Efeitos" hint="Cartas, vazas, K♥" on={prefs.sfx} onToggle={toggle("sfx")}>
          <Slider value={prefs.sfxVol} disabled={!prefs.sfx} onChange={(v) => audio.set({ sfxVol: v })} label="Volume dos efeitos" />
        </Row>
        <Row
          label="Vibração"
          hint={supportsHaptics ? "Resposta tátil" : "Não suportada neste navegador"}
          on={prefs.haptics && supportsHaptics}
          disabled={!supportsHaptics}
          onToggle={toggle("haptics")}
        />

        {/* SÓ no APK DEBUG de QA (constante de build): no build normal isto some do pacote. */}
        {DIAG_LIGADO && <BotaoDiagnosticoDeAudio />}

        <div style={{ marginTop: 14 }}>
          <button className="btn gold" onClick={() => { sfxTap(); onClose(); }}>Voltar ao jogo</button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, hint, on, onToggle, disabled, children,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="togglerow">
      <div className="top">
        <span className="lb">{label}<i>{hint}</i></span>
        <button
          className={`sw ${on ? "on" : ""}`}
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={disabled}
          onClick={disabled ? undefined : onToggle}
        />
      </div>
      {children}
    </div>
  );
}

/** Volume fino, independente do liga/desliga. Só ouvir resolve — daí o preview ao soltar. */
function Slider({
  value, onChange, disabled, label,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <input
      className="vol"
      type="range"
      min={0}
      max={100}
      step={5}
      value={Math.round(value * 100)}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      onPointerUp={() => !disabled && sfxTap()}
      onKeyUp={() => !disabled && sfxTap()}
    />
  );
}
