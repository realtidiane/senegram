import { useState } from "react";
import { usePush } from "../context/PushContext";
import { useAuth } from "../context/AuthContext";
import { Bell, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import api from "../services/api";

export default function PushTest() {
  const { user, token } = useAuth();
  const { subscribe, unsubscribe, subscription, permission, loading, publicKey, pushSupported } = usePush();
  const [testResult, setTestResult] = useState(null);

  async function handleTestPush() {
    if (!token) return;
    setTestResult({ status: "loading", message: "Envoi notification test..." });
    try {
      const { data } = await api.post("/push/test");
      if (data.success) {
        setTestResult({ status: "success", message: `Notification envoyée ! (sent: ${data.sent}, failed: ${data.failed})` });
      } else {
        setTestResult({ status: "error", message: data.message || "Erreur" });
      }
    } catch (err) {
      setTestResult({
        status: "error",
        message: err.response?.data?.message || err.message,
      });
    }
  }

  if (!user) return <div className="p-4 text-center text-ink-500">Connectez-vous pour tester</div>;

  return (
    <div className="p-4 rounded-xl bg-white border border-ink-100 space-y-4">
      <h3 className="font-semibold text-ink-900 flex items-center gap-2">
        <Bell className="w-5 h-5" />
        Test Notifications Push
      </h3>

      <div className="grid gap-2 text-sm">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-ink-50">
          <span className="font-medium">Support :</span>
          <span className={pushSupported ? "text-green-600" : "text-red-600"}>
            {pushSupported ? "OK" : "Non supporté"}
          </span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-ink-50">
          <span className="font-medium">Permission :</span>
          <span className={permission === "granted" ? "text-green-600" : "text-red-600"}>
            {permission}
          </span>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-ink-50">
          <span className="font-medium">Abonnement :</span>
          <span className={subscription ? "text-green-600" : "text-red-600"}>
            {subscription ? "Actif" : "Inactif"}
          </span>
          {subscription && (
            <span className="text-xs text-ink-500 ml-2 truncate max-w-[200px]">
              {subscription.endpoint.substring(0, 50)}...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-ink-50">
          <span className="font-medium">VAPID Key :</span>
          <span className="text-xs text-ink-500 truncate max-w-[200px]">
            {publicKey ? `${publicKey.substring(0, 30)}...` : "Non configurée"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={subscribe}
          disabled={!pushSupported || loading || (permission === "granted" && subscription)}
          className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {permission !== "granted" ? "Autoriser notifications" : subscription ? "Déjà abonné" : "S'abonner"}
        </button>

        <button
          onClick={unsubscribe}
          disabled={!subscription || loading}
          className="btn-ghost px-4 py-2 rounded-lg text-sm flex items-center gap-2 text-red-600"
        >
          <AlertCircle className="w-4 h-4" />
          Se désabonner
        </button>

        <button
          onClick={handleTestPush}
          disabled={!subscription || loading || !pushSupported}
          className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-brand-600 hover:bg-brand-700"
        >
          <Loader2 className="w-4 h-4" />
          Envoyer notification test
        </button>
      </div>

      {testResult && (
        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
          testResult.status === "success" ? "bg-green-50 text-green-700" :
          testResult.status === "error" ? "bg-red-50 text-red-700" :
          "bg-blue-50 text-blue-700"
        }`}>
          {testResult.status === "success" && <CheckCircle className="w-4 h-4" />}
          {testResult.status === "error" && <AlertCircle className="w-4 h-4" />}
          {testResult.status === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  );
}
