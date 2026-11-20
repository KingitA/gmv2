package com.gm.alarma;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import android.util.Log;

import java.util.Map;

/**
 * Mensajes de Firebase Cloud Messaging (de DATOS, prioridad alta). Corre aunque la app
 * esté cerrada: no depende del WebView.
 *   { tipo: "sonar", mensaje: "…" }  → AlarmaServicio.sonar
 *   { tipo: "detener" }              → AlarmaServicio.detener
 * El token nuevo se guarda y se avisa a la app (que lo manda al servidor).
 */
public class GmAlarmaMensajes extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String tipo = d != null ? d.get("tipo") : null;
        Log.i(GmAlarmaPlugin.TAG, "mensaje FCM: tipo=" + tipo + " prioridad=" + m.getPriority());
        if ("sonar".equals(tipo)) AlarmaServicio.sonar(this, d.get("mensaje"));
        else if ("detener".equals(tipo)) AlarmaServicio.detener(this);
    }

    @Override
    public void onNewToken(String token) {
        GmAlarmaPlugin.tokenNuevo(this, token);
    }
}
