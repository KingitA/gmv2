package com.gm.archivos;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Archivos para mostrar y compartir (PDF de comprobantes de la app Vendedor).
 *
 * - guardar({nombre, base64}): escribe el archivo en la caché de la app (carpeta
 *   "compartir") y devuelve su ruta. Nunca en almacenamiento público: no pide permisos.
 * - abrir({ruta, tipo}): lo abre con el visor del equipo (el visor de PDF ya trae
 *   "compartir").
 * - compartir({rutas, titulo}): hoja de compartir de Android con UNO o VARIOS archivos
 *   (WhatsApp, mail, Drive…).
 *
 * Actualización de la app con un botón (17/11/2026, MOBILE.md → "Actualización desde la app"):
 * - puedeInstalar(): ¿Android ya dejó que esta app instale APKs? (canRequestPackageInstalls)
 * - abrirPermisoInstalar(): abre el ajuste "instalar apps desconocidas" DE ESTA APP.
 * - descargarApk({url, sha256, nombre}): baja el APK a la caché (carpeta "actualizacion"),
 *   avisa el avance con el evento "progresoDescarga" y verifica el sha256. El archivo nunca
 *   se instala si no coincide.
 * - instalarApk({ruta}): abre el instalador de Android (el usuario toca INSTALAR).
 *
 * Los archivos salen por el FileProvider que ya declara la app
 * (${applicationId}.fileprovider, res/xml/file_paths.xml → cache-path).
 */
@CapacitorPlugin(name = "GmArchivos")
public class GmArchivosPlugin extends Plugin {

    private File carpeta() {
        File dir = new File(getContext().getCacheDir(), "compartir");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private Uri uriDe(File f) {
        Context ctx = getContext();
        return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
    }

    private File archivoDe(String ruta) {
        if (ruta == null) return null;
        File f = new File(ruta);
        // Solo archivos de nuestra carpeta (no se abre/comparte cualquier ruta del equipo)
        try {
            if (!f.getCanonicalPath().startsWith(carpeta().getCanonicalPath())) return null;
        } catch (Exception e) {
            return null;
        }
        return f.exists() ? f : null;
    }

    @PluginMethod
    public void guardar(PluginCall call) {
        String nombre = call.getString("nombre", "archivo.pdf");
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Falta el contenido del archivo");
            return;
        }
        String limpio = nombre.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        if (limpio.isEmpty()) limpio = "archivo.pdf";
        try {
            limpiarViejos();
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File f = new File(carpeta(), limpio);
            try (FileOutputStream out = new FileOutputStream(f, false)) {
                out.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("ruta", f.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo guardar el archivo: " + e.getMessage());
        }
    }

    @PluginMethod
    public void abrir(PluginCall call) {
        File f = archivoDe(call.getString("ruta"));
        if (f == null) {
            call.reject("El archivo no existe");
            return;
        }
        String tipo = call.getString("tipo", "application/pdf");
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uriDe(f), tipo);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No hay una app para ver PDF en este equipo", "SIN_VISOR");
        }
    }

    @PluginMethod
    public void compartir(PluginCall call) {
        JSArray rutas = call.getArray("rutas");
        String titulo = call.getString("titulo", "Compartir");
        String tipo = call.getString("tipo", "application/pdf");
        ArrayList<Uri> uris = new ArrayList<>();
        try {
            for (int k = 0; k < rutas.length(); k++) {
                File f = archivoDe(rutas.getString(k));
                if (f != null) uris.add(uriDe(f));
            }
        } catch (Exception e) {
            call.reject("Rutas inválidas");
            return;
        }
        if (uris.isEmpty()) {
            call.reject("No hay archivos para compartir");
            return;
        }
        Intent i;
        if (uris.size() == 1) {
            i = new Intent(Intent.ACTION_SEND);
            i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            i = new Intent(Intent.ACTION_SEND_MULTIPLE);
            i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        }
        i.setType(tipo);
        // ClipData: así el permiso de lectura viaja a la app que elija el usuario
        ClipData clip = ClipData.newRawUri("", uris.get(0));
        for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
        i.setClipData(clip);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(i, titulo);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No hay una app para compartir en este equipo");
        }
    }

    // ─── Actualización de la app ───────────────────────────────────────────────

    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    private File carpetaActualizacion() {
        File dir = new File(getContext().getCacheDir(), "actualizacion");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @PluginMethod
    public void puedeInstalar(PluginCall call) {
        boolean ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject ret = new JSObject();
        ret.put("valor", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void abrirPermisoInstalar(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No se pudo abrir el ajuste", "SIN_AJUSTE");
        }
    }

    @PluginMethod
    public void descargarApk(PluginCall call) {
        String url = call.getString("url");
        String sha = call.getString("sha256", "");
        String nombre = call.getString("nombre", "actualizacion.apk").replaceAll("[^A-Za-z0-9._-]", "_");
        if (url == null || !url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("URL inválida", "URL");
            return;
        }
        call.setKeepAlive(true);
        hilo.execute(() -> {
            File destino = new File(carpetaActualizacion(), nombre);
            HttpURLConnection con = null;
            try {
                // Solo queda la última bajada (la carpeta no crece)
                File[] viejos = carpetaActualizacion().listFiles();
                if (viejos != null) for (File v : viejos) v.delete();

                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(20000);
                con.setReadTimeout(60000);
                int status = con.getResponseCode();
                if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
                long total = con.getContentLengthLong();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long bajado = 0;
                long ultimoAviso = 0;
                try (InputStream in = con.getInputStream(); FileOutputStream out = new FileOutputStream(destino, false)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        md.update(buf, 0, n);
                        bajado += n;
                        long ahora = System.currentTimeMillis();
                        if (ahora - ultimoAviso > 250) {
                            ultimoAviso = ahora;
                            JSObject p = new JSObject();
                            p.put("bajado", bajado);
                            p.put("total", total);
                            notifyListeners("progresoDescarga", p);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (!sha.isEmpty() && !hex.toString().equalsIgnoreCase(sha)) {
                    destino.delete();
                    call.reject("El archivo llegó incompleto", "SHA");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("ruta", destino.getAbsolutePath());
                ret.put("sha256", hex.toString());
                call.resolve(ret);
            } catch (Exception e) {
                destino.delete();
                call.reject("No se pudo bajar: " + e.getMessage(), "RED");
            } finally {
                if (con != null) con.disconnect();
                call.setKeepAlive(false);
            }
        });
    }

    @PluginMethod
    public void instalarApk(PluginCall call) {
        File f = null;
        String ruta = call.getString("ruta");
        try {
            if (ruta != null) {
                File c = new File(ruta);
                if (c.getCanonicalPath().startsWith(carpetaActualizacion().getCanonicalPath()) && c.exists()) f = c;
            }
        } catch (Exception ignored) {
        }
        if (f == null) {
            call.reject("El archivo de la actualización no está", "SIN_ARCHIVO");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uriDe(f), "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No se pudo abrir el instalador", "SIN_INSTALADOR");
        }
    }

    /** Borra lo compartido hace más de un día (la caché no crece sin límite). */
    private void limpiarViejos() {
        File[] archivos = carpeta().listFiles();
        if (archivos == null) return;
        long limite = System.currentTimeMillis() - 24L * 3600L * 1000L;
        for (File f : archivos) {
            if (f.lastModified() < limite) f.delete();
        }
    }
}
