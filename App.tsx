import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Environment, envIsConfigured, loadEnv } from "./lib/config";
import { runFlow, FlowOutcome } from "./lib/flow";

/** Default test identity. Personnummer is the conventional test value
 *  from the partner guide §10 — coordinate with tech@worknode.se
 *  before running against real downstream pipelines. */
const DEFAULT_IDENTITY = {
  external_id: "expo-test-user",
  personnummer: "199001011234",
  full_name: "Test User",
  email: "test+integration@example.com",
  phone: "+46701234567",
};

export default function App() {
  const [target, setTarget] = useState<Environment>("staging");
  const [externalId, setExternalId] = useState(DEFAULT_IDENTITY.external_id);
  const [personnummer, setPersonnummer] = useState(DEFAULT_IDENTITY.personnummer);
  const [hasPersonnummer, setHasPersonnummer] = useState(true);
  const [fullName, setFullName] = useState(DEFAULT_IDENTITY.full_name);
  const [email, setEmail] = useState(DEFAULT_IDENTITY.email);
  const [phone, setPhone] = useState(DEFAULT_IDENTITY.phone);

  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);

  const env = useMemo(() => loadEnv(target), [target]);
  const ready = envIsConfigured(env);

  const run = async () => {
    setRunning(true);
    setOutcome(null);
    try {
      const result = await runFlow({
        env,
        identity: {
          external_id: externalId,
          // Omitted entirely (not an empty string) when simulating a
          // partner with no personnummer — the target integration must
          // have requires_personnummer=false or session-create rejects
          // this with a 400 same as if the field were just missing.
          ...(hasPersonnummer ? { personnummer } : {}),
          full_name: fullName,
          email,
          phone: phone || undefined,
        },
      });
      setOutcome(result);
    } finally {
      setRunning(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Worknode integration tester</Text>
        <Text style={styles.subtitle}>
          Dev-only harness. The static secret lives in this app's bundle —
          real partners ship the secret on a backend, not the device.
        </Text>

        <Section title="Environment">
          <View style={styles.row}>
            <Toggle
              label="Staging"
              active={target === "staging"}
              onPress={() => setTarget("staging")}
            />
            <Toggle
              label="Production"
              active={target === "prod"}
              onPress={() => setTarget("prod")}
              tone="warn"
            />
          </View>
          <Text style={styles.helper}>
            {env.apiBase || "<no api base configured>"} · slug={" "}
            {env.slug || "<missing>"}
          </Text>
          {!ready && (
            <Text style={styles.warn}>
              .env.local is incomplete for {target}. Fill in
              EXPO_PUBLIC_WORKNODE_{target.toUpperCase()}_* values and
              restart `expo start --clear`.
            </Text>
          )}
        </Section>

        <Section title="Identity (server-asserted)">
          <Field label="external_id" value={externalId} onChangeText={setExternalId} />

          <View style={styles.row}>
            <Toggle
              label="Has personnummer"
              active={hasPersonnummer}
              onPress={() => setHasPersonnummer(true)}
            />
            <Toggle
              label="No personnummer"
              active={!hasPersonnummer}
              onPress={() => setHasPersonnummer(false)}
              tone="warn"
            />
          </View>
          {hasPersonnummer ? (
            <Field
              label="personnummer"
              value={personnummer}
              onChangeText={setPersonnummer}
              keyboardType="number-pad"
            />
          ) : (
            <Text style={styles.helper}>
              personnummer will be omitted from the request entirely. Target
              integration must have requires_personnummer=false configured
              server-side, or session-create rejects this with a 400.
            </Text>
          )}

          <Field label="full_name" value={fullName} onChangeText={setFullName} />
          <Field label="email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </Section>

        <Pressable
          style={[styles.button, (!ready || running) && styles.buttonDisabled]}
          disabled={!ready || running}
          onPress={run}
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Run handoff flow</Text>
          )}
        </Pressable>

        {outcome && <OutcomeView outcome={outcome} />}

        <StatusBar style="auto" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  ...rest
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...rest}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        placeholderTextColor="#9aa3b2"
      />
    </View>
  );
}

function Toggle({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: "warn";
}) {
  const palette =
    tone === "warn" && active
      ? { bg: "#c0392b", fg: "#fff" }
      : active
        ? { bg: "#0F2C53", fg: "#fff" }
        : { bg: "#eef0f4", fg: "#1b1c1f" };
  return (
    <Pressable
      onPress={onPress}
      style={[styles.toggle, { backgroundColor: palette.bg }]}
    >
      <Text style={[styles.toggleText, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

function OutcomeView({ outcome }: { outcome: FlowOutcome }) {
  const palette =
    outcome.kind === "success"
      ? { bg: "#e8f6ec", border: "#3aa55c", title: "Signed callback verified" }
      : outcome.kind === "user_cancelled"
        ? { bg: "#fef3f1", border: "#F67A5C", title: "User cancelled" }
        : outcome.kind === "verification_failed"
          ? { bg: "#fef3f1", border: "#c0392b", title: "Verification failed" }
          : { bg: "#fef3f1", border: "#c0392b", title: "API error" };

  return (
    <View
      style={[
        styles.outcome,
        { backgroundColor: palette.bg, borderLeftColor: palette.border },
      ]}
    >
      <Text style={styles.outcomeTitle}>{palette.title}</Text>
      <Text style={styles.outcomeBody}>
        {JSON.stringify(outcome, null, 2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f7f8fb" },
  container: { padding: 18, paddingTop: 60, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: "700", color: "#0F2C53" },
  subtitle: { fontSize: 12, color: "#606771", marginTop: 4, marginBottom: 18 },
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e1e6eb",
  },
  sectionTitle: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#606771",
    marginBottom: 10,
  },
  row: { flexDirection: "row", gap: 8 },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  toggleText: { fontSize: 14, fontWeight: "600" },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, color: "#606771", marginBottom: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#cfd5de",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#1b1c1f",
    backgroundColor: "#fafbfc",
  },
  helper: { fontSize: 11, color: "#8b95a2", marginTop: 6 },
  warn: { fontSize: 12, color: "#c0392b", marginTop: 8 },
  button: {
    backgroundColor: "#0F2C53",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { backgroundColor: "#9aa3b2" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  outcome: {
    marginTop: 18,
    padding: 12,
    borderRadius: 6,
    borderLeftWidth: 3,
  },
  outcomeTitle: { fontWeight: "700", marginBottom: 6, color: "#1b1c1f" },
  outcomeBody: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    color: "#1b1c1f",
  },
});
