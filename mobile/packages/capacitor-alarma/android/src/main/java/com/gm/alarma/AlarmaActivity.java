package com.gm.alarma;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * Aviso de pantalla completa mientras el equipo suena: "¡Te están buscando! — Tocá para
 * apagar". Se muestra encima de la pantalla bloqueada y la prende. Cualquier toque apaga
 * la alarma. Letra enorme: lo usa gente grande, con el equipo perdido entre la mercadería.
 */
public class AlarmaActivity extends Activity {

    private static WeakReference<AlarmaActivity> actual = new WeakReference<>(null);

    static void cerrarSiEsta() {
        AlarmaActivity a = actual.get();
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        actual = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);

        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setGravity(Gravity.CENTER);
        raiz.setBackgroundColor(Color.parseColor("#B91C1C"));
        raiz.setPadding(48, 48, 48, 48);

        TextView campana = new TextView(this);
        campana.setText("🔔");
        campana.setTextSize(96);
        campana.setGravity(Gravity.CENTER);

        TextView titulo = new TextView(this);
        titulo.setText("¡Te están buscando!");
        titulo.setTextColor(Color.WHITE);
        titulo.setTextSize(40);
        titulo.setTypeface(Typeface.DEFAULT_BOLD);
        titulo.setGravity(Gravity.CENTER);

        String msj = getIntent() != null ? getIntent().getStringExtra("mensaje") : null;
        TextView detalle = new TextView(this);
        detalle.setText(msj != null && !msj.isEmpty() ? msj : "");
        detalle.setTextColor(Color.parseColor("#FEE2E2"));
        detalle.setTextSize(22);
        detalle.setGravity(Gravity.CENTER);
        detalle.setPadding(0, 24, 0, 24);

        TextView apagar = new TextView(this);
        apagar.setText("TOCÁ PARA APAGAR");
        apagar.setTextColor(Color.parseColor("#B91C1C"));
        apagar.setBackgroundColor(Color.WHITE);
        apagar.setTextSize(30);
        apagar.setTypeface(Typeface.DEFAULT_BOLD);
        apagar.setGravity(Gravity.CENTER);
        apagar.setPadding(24, 48, 24, 48);

        raiz.addView(campana);
        raiz.addView(titulo);
        raiz.addView(detalle);
        raiz.addView(apagar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        raiz.setOnClickListener((v) -> apagar());
        apagar.setOnClickListener((v) -> apagar());
        setContentView(raiz);
    }

    private void apagar() {
        AlarmaServicio.detener(this);
        finish();
    }

    @Override
    public void onBackPressed() {
        apagar();
    }

    @Override
    protected void onDestroy() {
        if (actual.get() == this) actual = new WeakReference<>(null);
        super.onDestroy();
    }
}
