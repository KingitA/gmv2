package com.gm.alarma;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * Hace sonar el equipo (MOBILE.md → "Hacer sonar un equipo"): alarma FUERTE por el canal
 * de ALARMA (suena aunque el equipo esté en silencio; con "no molestar", si Android deja
 * pasar las alarmas), vibra y muestra el aviso de pantalla completa. Hasta 60 s o hasta
 * que lo apaguen (AlarmaActivity / acción de la notificación / mensaje "detener").
 *
 * Es un servicio en primer plano: así sigue sonando con la app cerrada y la pantalla
 * apagada (Android deja arrancarlo desde un mensaje FCM de prioridad alta).
 */
public class AlarmaServicio extends Service {

    static final String ACCION_SONAR = "com.gm.alarma.SONAR";
    static final String ACCION_DETENER = "com.gm.alarma.DETENER";
    static final String CANAL = "gm_alarma_equipo";
    static final int ID_NOTIF = 4711;
    static final long DURACION_MS = 60_000L;

    private MediaPlayer player;
    private Vibrator vibrador;
    private PowerManager.WakeLock wakeLock;
    private int volumenPrevio = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable cortar = this::detenerTodo;

    /** Arranca la alarma (desde el mensaje FCM o el plugin). */
    static void sonar(Context ctx, String mensaje) {
        Intent i = new Intent(ctx, AlarmaServicio.class).setAction(ACCION_SONAR).putExtra("mensaje", mensaje);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            // Android no dejó arrancar el servicio: al menos el aviso de pantalla completa
            notificar(ctx, mensaje);
        }
    }

    static void detener(Context ctx) {
        try {
            ctx.startService(new Intent(ctx, AlarmaServicio.class).setAction(ACCION_DETENER));
        } catch (Exception ignored) {
            ctx.stopService(new Intent(ctx, AlarmaServicio.class));
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID_NOTIF);
    }

    static void crearCanal(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CANAL) != null) return;
        NotificationChannel c = new NotificationChannel(CANAL, "Buscar este equipo", NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("Suena cuando la oficina o un compañero busca este equipo");
        // El sonido lo pone el servicio (canal de alarma, a todo volumen); la notificación va muda
        c.setSound(null, null);
        c.enableVibration(false);
        c.setBypassDnd(true);
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(c);
    }

    static Notification construir(Context ctx, String mensaje) {
        crearCanal(ctx);
        Intent abrir = new Intent(ctx, AlarmaActivity.class).putExtra("mensaje", mensaje)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pantalla = PendingIntent.getActivity(ctx, 1, abrir, flags);
        PendingIntent apagar = PendingIntent.getService(ctx, 2, new Intent(ctx, AlarmaServicio.class).setAction(ACCION_DETENER), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(ctx, CANAL) : new Notification.Builder(ctx);
        return b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("¡Te están buscando!")
            .setContentText(mensaje != null && !mensaje.isEmpty() ? mensaje : "Tocá para apagar")
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pantalla)
            .setFullScreenIntent(pantalla, true)
            .addAction(new Notification.Action.Builder(null, "APAGAR", apagar).build())
            .build();
    }

    private static void notificar(Context ctx, String mensaje) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID_NOTIF, construir(ctx, mensaje));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent != null ? intent.getAction() : null;
        if (ACCION_DETENER.equals(accion)) {
            detenerTodo();
            return START_NOT_STICKY;
        }
        String mensaje = intent != null ? intent.getStringExtra("mensaje") : null;
        Notification n = construir(this, mensaje);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID_NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID_NOTIF, n);
        empezar();
        // Prende la pantalla con el aviso (si Android no lo muestra solo por la notificación)
        try {
            startActivity(new Intent(this, AlarmaActivity.class).putExtra("mensaje", mensaje).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
        } catch (Exception ignored) {
        }
        handler.removeCallbacks(cortar);
        handler.postDelayed(cortar, DURACION_MS);
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private void empezar() {
        if (player != null) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gm:alarma");
            wakeLock.acquire(DURACION_MS + 5_000L);
        } catch (Exception ignored) {
        }
        // A todo volumen el canal de alarma (se devuelve como estaba al terminar)
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        try {
            volumenPrevio = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        } catch (Exception ignored) {
        }
        // Sonido PROPIO primero (res/raw/gm_alarma.wav): el NuStar no tiene tono de alarma por
        // defecto que se pueda abrir. Si falla, los del sistema. Un error acá NO corta la
        // vibración ni la pantalla (van aparte).
        Uri[] tonos = {
            Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.gm_alarma),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
        };
        String[] nombres = { "propio (gm_alarma)", "alarma del sistema", "tono de llamada", "notificación" };
        for (int k = 0; k < tonos.length && player == null; k++) {
            if (tonos[k] == null) continue;
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                mp.setDataSource(this, tonos[k]);
                mp.setLooping(true);
                mp.prepare();
                mp.start();
                player = mp;
                Log.i(GmAlarmaPlugin.TAG, "sonido: " + nombres[k]);
            } catch (Exception e) {
                Log.e(GmAlarmaPlugin.TAG, "sonido: falló " + nombres[k] + " — " + e.getMessage());
                try {
                    mp.release();
                } catch (Exception ignored) {
                }
            }
        }
        if (player == null) Log.e(GmAlarmaPlugin.TAG, "sonido: ninguno se pudo reproducir (solo vibra)");
        try {
            vibrador = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            long[] patron = {0, 800, 400};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrador.vibrate(VibrationEffect.createWaveform(patron, 0));
            else vibrador.vibrate(patron, 0);
        } catch (Exception ignored) {
        }
    }

    private void detenerTodo() {
        handler.removeCallbacks(cortar);
        try {
            if (player != null) {
                player.stop();
                player.release();
            }
        } catch (Exception ignored) {
        }
        player = null;
        try {
            if (vibrador != null) vibrador.cancel();
        } catch (Exception ignored) {
        }
        try {
            if (volumenPrevio >= 0) ((AudioManager) getSystemService(Context.AUDIO_SERVICE)).setStreamVolume(AudioManager.STREAM_ALARM, volumenPrevio, 0);
        } catch (Exception ignored) {
        }
        volumenPrevio = -1;
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        AlarmaActivity.cerrarSiEsta();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(cortar);
        try {
            if (player != null) player.release();
        } catch (Exception ignored) {
        }
        try {
            if (vibrador != null) vibrador.cancel();
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
