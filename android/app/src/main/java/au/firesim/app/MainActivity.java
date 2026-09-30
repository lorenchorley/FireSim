package au.firesim.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Hardware Back goes to the web app first. While the page has a history entry to go back to (FireSim keeps one guard
 * entry while a dialog, a screen, a menu or the simulation can be closed: src/ui/backStack.ts), Back is
 * WebView.goBack(), which the app receives as popstate and answers by closing the top-most thing. With no entry left
 * (Setup with nothing open), Back leaves the app as usual. (Without this, and without the @capacitor/app plugin, Android
 * would close the app on the first Back from any screen.)
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge b = getBridge();
                WebView web = b != null ? b.getWebView() : null;
                if (web != null && web.canGoBack()) {
                    web.goBack();
                    return;
                }
                // Nothing left to close in the app: the system default (leave the app).
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
