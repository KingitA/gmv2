package com.gm.alarma;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import java.lang.ref.WeakReference;

/**
 * Hacer sonar un equipo perdido (MOBILE.md → "Hacer sonar un equipo").
 * - token(): token de Firebase de ESTE equipo (rechaza "SIN_FIREBASE" si el APK se compiló
 *   sin google-services.json).
 * - permisoNotificaciones() / pedirPermisoNotificaciones(): Android 13+ pide permiso para
 *   avisar (sin él la alarma suena igual, pero no se ve el aviso).
 * - probar(): suena 60 s en este mismo equipo (para probar sin el servidor).
 * - detener(): apaga la alarma.
 * Evento "token" cuando Firebase cambia el token.
 */
@CapacitorPlugin(
    name = "GmAlarma",
    permissions = { @Permission(alias = "notificaciones", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class GmAlarmaPlugin extends Plugin {

    private static WeakReference<GmAlarmaPlugin> instancia = new WeakReference<>(null);

    @Override
    public void load() {
        instancia = new WeakReference<>(this);
        AlarmaServicio.crearCanal(getContext());
    }

    static void tokenNuevo(Context ctx, String token) {
        GmAlarmaPlugin p = instancia.get();
        if (p != null) {
            JSObject d = new JSObject();
            d.put("token", token);
            p.notifyListeners("token", d, true);
        }
    }

    @PluginMethod
    public void token(PluginCall call) {
        FirebaseMessaging fm;
        try {
            fm = FirebaseMessaging.getInstance();
        } catch (Exception e) {
            call.reject("Este APK no tiene Firebase configurado", "SIN_FIREBASE");
            return;
        }
        fm.getToken().addOnCompleteListener((t) -> {
            if (t.isSuccessful() && t.getResult() != null) {
                JSObject r = new JSObject();
                r.put("token", t.getResult());
                call.resolve(r);
            } else {
                call.reject("No se pudo obtener el token", "SIN_TOKEN");
            }
        });
    }

    private boolean tienePermiso() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void permisoNotificaciones(PluginCall call) {
        JSObject r = new JSObject();
        r.put("valor", tienePermiso());
        call.resolve(r);
    }

    @PluginMethod
    public void pedirPermisoNotificaciones(PluginCall call) {
        if (tienePermiso()) {
            JSObject r = new JSObject();
            r.put("valor", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notificaciones", call, "alPedirPermiso");
    }

    @PermissionCallback
    private void alPedirPermiso(PluginCall call) {
        JSObject r = new JSObject();
        r.put("valor", getPermissionState("notificaciones") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void probar(PluginCall call) {
        AlarmaServicio.sonar(getContext(), call.getString("mensaje", "Prueba de alarma"));
        call.resolve();
    }

    @PluginMethod
    public void detener(PluginCall call) {
        AlarmaServicio.detener(getContext());
        call.resolve();
    }
}
