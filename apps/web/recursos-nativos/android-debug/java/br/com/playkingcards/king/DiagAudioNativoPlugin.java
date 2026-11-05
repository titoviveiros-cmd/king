package br.com.playkingcards.king;

// DIAGNÓSTICO DE ÁUDIO NATIVO — SÓ NO APK DEBUG (source set `debug`: este arquivo NÃO entra no build
// release nem no AAB). Rodada 6, 04/11/2026: separar em que camada o som some no Android.
//
// Dois verbos, ambos chamados só por um botão do painel "Diagnóstico de áudio":
//   estado()   — SÓ LEITURA do áudio do sistema: volume de mídia, mudo, modo de campainha, modo de áudio,
//                saídas (TIPOS, nunca nome/endereço), reproduções ativas (uso/conteúdo), WebView e os
//                eventos vistos desde que o app abriu (saída entrou/saiu, volume de mídia mudou, tela
//                ligou/desligou, pausa/volta do app, reproduções mudaram).
//   tocarTom() — teste C: 0,6 s de tom por AudioTrack (USAGE_MEDIA, como a WebView), SEM pedir foco de
//                áudio (a WebView também não pede) — fora da WebView inteira.
// Nada de microfone (nenhuma permissão de gravação), nada de identificador do aparelho, nada de rede.

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayDeque;
import java.util.List;
import java.util.TreeSet;

@CapacitorPlugin(name = "DiagAudioNativo")
public class DiagAudioNativoPlugin extends Plugin {
    private static final int MAX_EVENTOS = 120;
    private final ArrayDeque<JSObject> eventos = new ArrayDeque<>();
    private final long inicio = SystemClock.elapsedRealtime();
    private AudioManager am;
    private Object cbReproducoes; // AudioManager.AudioPlaybackCallback (API 26+)
    private AudioDeviceCallback cbSaidas;
    private BroadcastReceiver receptor;
    private Boolean gestoExigido;
    private String webviewPacote;

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        Handler principal = new Handler(Looper.getMainLooper());
        try {
            WebView wv = getBridge().getWebView();
            gestoExigido = wv.getSettings().getMediaPlaybackRequiresUserGesture();
        } catch (Exception e) {
            gestoExigido = null;
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
                if (pi != null) webviewPacote = pi.packageName + " " + pi.versionName;
            }
        } catch (Exception ignorado) { }
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            AudioManager.AudioPlaybackCallback cb = new AudioManager.AudioPlaybackCallback() {
                @Override
                public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) {
                    JSObject e = new JSObject();
                    e.put("ativas", configs.size());
                    e.put("usos", usos(configs));
                    evento("reproducoes-mudaram", e);
                }
            };
            am.registerAudioPlaybackCallback(cb, principal);
            cbReproducoes = cb;
        }
        cbSaidas = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] d) {
                JSObject e = new JSObject();
                e.put("tipos", tipos(d));
                evento("saida-entrou", e);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] d) {
                JSObject e = new JSObject();
                e.put("tipos", tipos(d));
                evento("saida-saiu", e);
            }
        };
        am.registerAudioDeviceCallback(cbSaidas, principal);
        receptor = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                String a = i.getAction();
                if (a == null) return;
                JSObject e = new JSObject();
                switch (a) {
                    case "android.media.VOLUME_CHANGED_ACTION":
                        if (i.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1) != AudioManager.STREAM_MUSIC) return;
                        e.put("volumeMidia", i.getIntExtra("android.media.EXTRA_VOLUME_STREAM_VALUE", -1));
                        evento("volume-midia-mudou", e);
                        break;
                    case AudioManager.RINGER_MODE_CHANGED_ACTION:
                        e.put("modo", modoCampainha(am.getRingerMode()));
                        evento("campainha-mudou", e);
                        break;
                    case AudioManager.ACTION_AUDIO_BECOMING_NOISY:
                        evento("saida-ruidosa (fone/Bluetooth saiu)", e);
                        break;
                    case Intent.ACTION_HEADSET_PLUG:
                        e.put("conectado", i.getIntExtra("state", -1) == 1);
                        evento("fone-com-fio", e);
                        break;
                    case Intent.ACTION_SCREEN_OFF:
                        evento("tela-desligou", e);
                        break;
                    case Intent.ACTION_SCREEN_ON:
                        evento("tela-ligou", e);
                        break;
                    case Intent.ACTION_USER_PRESENT:
                        evento("desbloqueou", e);
                        break;
                    default:
                }
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction("android.media.VOLUME_CHANGED_ACTION");
        f.addAction(AudioManager.RINGER_MODE_CHANGED_ACTION);
        f.addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        f.addAction(Intent.ACTION_HEADSET_PLUG);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(getContext(), receptor, f, ContextCompat.RECEIVER_NOT_EXPORTED);
        evento("plugin-carregado", new JSObject());
    }

    @Override
    protected void handleOnPause() { evento("app-pausou", new JSObject()); }

    @Override
    protected void handleOnResume() { evento("app-voltou", new JSObject()); }

    @Override
    protected void handleOnStop() { evento("app-parou", new JSObject()); }

    @Override
    protected void handleOnDestroy() {
        try {
            if (am != null && Build.VERSION.SDK_INT >= 26 && cbReproducoes != null) {
                am.unregisterAudioPlaybackCallback((AudioManager.AudioPlaybackCallback) cbReproducoes);
            }
            if (am != null && cbSaidas != null) am.unregisterAudioDeviceCallback(cbSaidas);
            if (receptor != null) getContext().unregisterReceiver(receptor);
        } catch (Exception ignorado) { }
    }

    @PluginMethod
    public void estado(PluginCall call) {
        call.resolve(estadoAtual(true));
    }

    @PluginMethod
    public void tocarTom(final PluginCall call) {
        final int freq = call.getInt("freq", 660);
        final int ms = Math.max(100, Math.min(1500, call.getInt("ms", 600)));
        new Thread(() -> {
            JSObject r = new JSObject();
            r.put("antes", estadoAtual(false));
            AudioTrack t = null;
            try {
                int taxa = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
                if (taxa <= 0) taxa = 48000;
                int n = taxa * ms / 1000;
                int rampa = taxa / 50;
                short[] pcm = new short[n];
                for (int i = 0; i < n; i++) {
                    double env = Math.min(1.0, Math.min(i / (double) rampa, (n - 1 - i) / (double) rampa));
                    pcm[i] = (short) (Math.sin(2 * Math.PI * freq * i / taxa) * 0.25 * env * 32767);
                }
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                AudioFormat fmt = new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(taxa)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build();
                t = new AudioTrack.Builder()
                        .setAudioAttributes(attrs)
                        .setAudioFormat(fmt)
                        .setTransferMode(AudioTrack.MODE_STATIC)
                        .setBufferSizeInBytes(n * 2)
                        .build();
                r.put("taxa", taxa);
                r.put("trilhaIniciada", t.getState() == AudioTrack.STATE_INITIALIZED);
                int escrito = t.write(pcm, 0, n);
                r.put("amostrasEscritas", escrito);
                r.put("amostrasTotal", n);
                t.play();
                r.put("estadoDeReproducao", t.getPlayState() == AudioTrack.PLAYSTATE_PLAYING ? "tocando" : String.valueOf(t.getPlayState()));
                SystemClock.sleep(250);
                r.put("cabeca250ms", t.getPlaybackHeadPosition());
                AudioDeviceInfo rota = t.getRoutedDevice();
                r.put("rotaDaTrilha", rota != null ? tipo(rota.getType()) : "nenhuma");
                r.put("durante", estadoAtual(false));
                SystemClock.sleep(ms + 150 - 250);
                r.put("cabecaFim", t.getPlaybackHeadPosition());
                r.put("faltas", t.getUnderrunCount());
                t.stop();
                r.put("tocou", escrito == n);
            } catch (Exception e) {
                r.put("tocou", false);
                String m = e.getClass().getSimpleName() + ": " + e.getMessage();
                r.put("erro", m.length() > 120 ? m.substring(0, 120) : m);
            } finally {
                if (t != null) t.release();
            }
            evento("teste-nativo", new JSObject().put("tocou", r.optBoolean("tocou")));
            call.resolve(r);
        }, "king-diag-tom").start();
    }

    // ───────── leitura ─────────

    private JSObject estadoAtual(boolean comEventos) {
        JSObject o = new JSObject();
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("desdeOPluginMs", SystemClock.elapsedRealtime() - inicio);
        if (gestoExigido != null) o.put("webviewGestoExigido", gestoExigido);
        if (webviewPacote != null) o.put("webviewPacote", webviewPacote);
        if (am == null) {
            o.put("erro", "sem AudioManager");
            return o;
        }
        try {
            o.put("volumeMidia", am.getStreamVolume(AudioManager.STREAM_MUSIC));
            o.put("volumeMidiaMax", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            if (Build.VERSION.SDK_INT >= 28) o.put("volumeMidiaMin", am.getStreamMinVolume(AudioManager.STREAM_MUSIC));
            o.put("midiaMuda", am.isStreamMute(AudioManager.STREAM_MUSIC));
            o.put("volumeFixo", am.isVolumeFixed());
            o.put("modoCampainha", modoCampainha(am.getRingerMode()));
            o.put("modoAudio", modoAudio(am.getMode()));
            o.put("musicaAtiva", am.isMusicActive());
            o.put("saidas", tipos(am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)));
            o.put("taxaNativa", am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE));
            o.put("framesPorBuffer", am.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER));
            if (Build.VERSION.SDK_INT >= 26) {
                List<AudioPlaybackConfiguration> c = am.getActivePlaybackConfigurations();
                o.put("reproducoesAtivas", c.size());
                o.put("reproducoesUsos", usos(c));
                if (Build.VERSION.SDK_INT >= 30) {
                    TreeSet<String> rotas = new TreeSet<>();
                    for (AudioPlaybackConfiguration p : c) {
                        AudioDeviceInfo d = p.getAudioDeviceInfo();
                        if (d != null) rotas.add(tipo(d.getType()));
                    }
                    o.put("rotaAtual", rotas.isEmpty() ? "nenhuma reprodução ativa" : android.text.TextUtils.join(",", rotas));
                }
            }
        } catch (Exception e) {
            o.put("erro", e.getClass().getSimpleName());
        }
        if (comEventos) {
            JSArray lista = new JSArray();
            synchronized (eventos) {
                for (JSObject e : eventos) lista.put(e);
            }
            o.put("eventos", lista);
        }
        return o;
    }

    private void evento(String nome, JSObject dados) {
        dados.put("ms", SystemClock.elapsedRealtime() - inicio);
        dados.put("e", nome);
        synchronized (eventos) {
            eventos.addLast(dados);
            while (eventos.size() > MAX_EVENTOS) eventos.removeFirst();
        }
    }

    /** Uso/conteúdo de cada reprodução ativa (sem quem toca: o Android anonimiza as dos outros apps). */
    private static String usos(List<AudioPlaybackConfiguration> c) {
        StringBuilder sb = new StringBuilder();
        for (AudioPlaybackConfiguration p : c) {
            AudioAttributes a = p.getAudioAttributes();
            if (sb.length() > 0) sb.append(';');
            sb.append(uso(a.getUsage())).append('/').append(conteudo(a.getContentType()));
        }
        return sb.length() == 0 ? "nenhuma" : sb.toString();
    }

    /** Só os TIPOS das saídas (alto-falante, fone, Bluetooth…) — nunca nome do produto nem endereço. */
    private static String tipos(AudioDeviceInfo[] d) {
        TreeSet<String> s = new TreeSet<>();
        for (AudioDeviceInfo i : d) s.add(tipo(i.getType()));
        return android.text.TextUtils.join(",", s);
    }

    private static String tipo(int t) {
        switch (t) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "alto-falante";
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "auricular";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "fone-com-microfone";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "fone-com-fio";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "bluetooth-a2dp";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "bluetooth-sco";
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "usb";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "fone-usb";
            case AudioDeviceInfo.TYPE_HDMI: return "hdmi";
            case AudioDeviceInfo.TYPE_TELEPHONY: return "telefonia";
            case 26: return "ble-headset";
            case 27: return "ble-speaker";
            case 30: return "ble-broadcast";
            case AudioDeviceInfo.TYPE_REMOTE_SUBMIX: return "remote-submix";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE: return "alto-falante-seguro";
            default: return "tipo-" + t;
        }
    }

    private static String uso(int u) {
        switch (u) {
            case AudioAttributes.USAGE_MEDIA: return "media";
            case AudioAttributes.USAGE_GAME: return "game";
            case AudioAttributes.USAGE_NOTIFICATION: return "notificacao";
            case AudioAttributes.USAGE_ALARM: return "alarme";
            case AudioAttributes.USAGE_VOICE_COMMUNICATION: return "voz";
            case AudioAttributes.USAGE_ASSISTANCE_SONIFICATION: return "sonificacao";
            case AudioAttributes.USAGE_ASSISTANT: return "assistente";
            case AudioAttributes.USAGE_NOTIFICATION_RINGTONE: return "toque";
            case AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE: return "navegacao";
            default: return "uso-" + u;
        }
    }

    private static String conteudo(int c) {
        switch (c) {
            case AudioAttributes.CONTENT_TYPE_MUSIC: return "musica";
            case AudioAttributes.CONTENT_TYPE_MOVIE: return "filme";
            case AudioAttributes.CONTENT_TYPE_SPEECH: return "fala";
            case AudioAttributes.CONTENT_TYPE_SONIFICATION: return "sonificacao";
            default: return "desconhecido";
        }
    }

    private static String modoCampainha(int m) {
        switch (m) {
            case AudioManager.RINGER_MODE_SILENT: return "silencioso";
            case AudioManager.RINGER_MODE_VIBRATE: return "vibrar";
            case AudioManager.RINGER_MODE_NORMAL: return "normal";
            default: return "modo-" + m;
        }
    }

    private static String modoAudio(int m) {
        switch (m) {
            case AudioManager.MODE_NORMAL: return "normal";
            case AudioManager.MODE_RINGTONE: return "tocando-chamada";
            case AudioManager.MODE_IN_CALL: return "em-chamada";
            case AudioManager.MODE_IN_COMMUNICATION: return "em-comunicacao";
            default: return "modo-" + m;
        }
    }
}
