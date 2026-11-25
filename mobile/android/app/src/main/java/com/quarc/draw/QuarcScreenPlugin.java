package com.quarc.draw;

import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Full-screen drawing on Android. JS name: QuarcScreen.
 *
 * The web Fullscreen API can't be used here: Capacitor's WebChromeClient ends
 * it the moment it starts (onShowCustomView → onCustomViewHidden). Instead this
 * hides the status and navigation bars ("immersive"); a swipe from the edge
 * shows them for a moment without leaving full screen.
 */
@CapacitorPlugin(name = "QuarcScreen")
public class QuarcScreenPlugin extends Plugin {

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            try {
                Window window = getActivity().getWindow();
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
                if (on) {
                    bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    bars.hide(WindowInsetsCompat.Type.systemBars());
                } else {
                    bars.show(WindowInsetsCompat.Type.systemBars());
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not change the system bars", e);
            }
        });
    }
}
