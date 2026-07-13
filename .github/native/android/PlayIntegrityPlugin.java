package ai.huanyu.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.StandardIntegrityManager;
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest;
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider;
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest;

@CapacitorPlugin(name = "PlayIntegrity")
public class PlayIntegrityPlugin extends Plugin {
    private StandardIntegrityManager manager;
    private long cloudProjectNumber;
    private Task<StandardIntegrityTokenProvider> providerTask;

    @Override
    public void load() {
        manager = IntegrityManagerFactory.createStandard(getContext());
        String raw = getConfig().getString("cloudProjectNumber", "");
        try {
            cloudProjectNumber = Long.parseLong(raw);
        } catch (NumberFormatException ignored) {
            cloudProjectNumber = 0;
        }
    }

    private synchronized Task<StandardIntegrityTokenProvider> provider() {
        if (providerTask == null || (providerTask.isComplete() && !providerTask.isSuccessful())) {
            providerTask = manager.prepareIntegrityToken(
                PrepareIntegrityTokenRequest.builder()
                    .setCloudProjectNumber(cloudProjectNumber)
                    .build()
            );
        }
        return providerTask;
    }

    private boolean configured(PluginCall call) {
        if (cloudProjectNumber > 0) return true;
        call.reject("Play Integrity cloud project number is not configured", "NOT_CONFIGURED");
        return false;
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        if (!configured(call)) return;
        provider().addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("Play Integrity preparation failed", error));
    }

    @PluginMethod
    public void requestToken(PluginCall call) {
        if (!configured(call)) return;
        String requestHash = call.getString("requestHash", "");
        if (!requestHash.matches("^[A-Za-z0-9_-]{43}$")) {
            call.reject("Invalid request hash", "INVALID_HASH");
            return;
        }
        provider().addOnSuccessListener(tokenProvider -> tokenProvider.request(
            StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
        ).addOnSuccessListener(response -> {
            JSObject result = new JSObject();
            result.put("token", response.token());
            call.resolve(result);
        }).addOnFailureListener(error -> call.reject("Play Integrity token request failed", error)))
        .addOnFailureListener(error -> call.reject("Play Integrity preparation failed", error));
    }
}
