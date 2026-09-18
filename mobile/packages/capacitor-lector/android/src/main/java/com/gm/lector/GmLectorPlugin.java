package com.gm.lector;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Recibe las lecturas del escáner integrado cuando el servicio del equipo está
 * configurado en "salida por broadcast" y las emite a JS como evento "codigo".
 *
 * La acción y el extra dependen del firmware del handheld; se configuran desde
 * JS con configurar({accion, extra}) y quedan persistidos. Los defaults son los
 * más comunes en equipos MTK/Android genéricos (ScanManager). En modo keyboard
 * wedge este plugin no interviene (lo maneja @gm/core en JS).
 */
@CapacitorPlugin(name = "GmLector")
public class GmLectorPlugin extends Plugin {

    private static final String PREFS = "gm_lector";
    private static final String DEF_ACCION = "android.intent.ACTION_DECODE_DATA";
    private static final String DEF_EXTRA = "barcode_string";

    private BroadcastReceiver receptor;

    @Override
    public void load() {
        registrar();
    }

    @PluginMethod
    public void configurar(PluginCall call) {
        String accion = call.getString("accion", DEF_ACCION);
        String extra = call.getString("extra", DEF_EXTRA);
        prefs().edit().putString("accion", accion).putString("extra", extra).apply();
        registrar();
        call.resolve();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void registrar() {
        Context ctx = getContext();
        if (receptor != null) {
            try {
                ctx.unregisterReceiver(receptor);
            } catch (IllegalArgumentException ignored) {
            }
        }
        final String accion = prefs().getString("accion", DEF_ACCION);
        final String extra = prefs().getString("extra", DEF_EXTRA);
        receptor = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String codigo = intent.getStringExtra(extra);
                if (codigo == null) {
                    // Algunos firmwares mandan bytes en vez de String
                    byte[] bytes = intent.getByteArrayExtra(extra);
                    if (bytes != null) codigo = new String(bytes);
                }
                if (codigo == null || codigo.trim().isEmpty()) return;
                JSObject data = new JSObject();
                data.put("codigo", codigo.trim());
                notifyListeners("codigo", data);
            }
        };
        IntentFilter filtro = new IntentFilter(accion);
        // El servicio de escaneo es otra app del sistema: el receptor debe ser EXPORTED
        ContextCompat.registerReceiver(ctx, receptor, filtro, ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (receptor != null) {
            try {
                getContext().unregisterReceiver(receptor);
            } catch (IllegalArgumentException ignored) {
            }
            receptor = null;
        }
    }
}
