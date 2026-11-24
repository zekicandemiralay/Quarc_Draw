package com.quarc.draw;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Quarc Store single sign-on (see Quarc_Store/sso-kit/README.md).
        registerPlugin(QuarcSsoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
