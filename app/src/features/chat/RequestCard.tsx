import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApprovalChoice, ServerRequest } from "@/lib/gateway/types";
import { Button, Chip, IconName } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";
import { RequestFrame } from "./RequestFrame";
import { LoginRequestCard } from "./LoginRequestCard";

export type Props = {
  request: ServerRequest;
  botName: string;
  onAnswer: (id: string, result: Record<string, unknown>) => void;
  onDecline: (id: string) => void;
};

const APPROVAL_LABELS: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow this chat",
  always: "Always allow",
  deny: "Deny",
};

const Frame = RequestFrame;

function Approval({ request, botName, onAnswer }: Props) {
  const styles = useStyles();
  const { type } = useTheme();
  const p = request.params;
  const offered: ApprovalChoice[] = Array.isArray(p.choices) && p.choices.length
    ? p.choices
    : (["once", p.allow_session !== false && "session", p.allow_permanent !== false && "always", "deny"].filter(Boolean) as ApprovalChoice[]);
  return (
    <Frame icon="shield-checkmark" title={`${botName} wants to run${p.tool_name ? ` ${p.tool_name}` : ""}`}>
      {p.description ? <Text style={styles.body}>{String(p.description)}</Text> : null}
      {p.command ? (
        <Text selectable style={[type.mono, styles.command]} numberOfLines={8}>
          {String(p.command)}
        </Text>
      ) : null}
      <View style={styles.row}>
        {offered.filter((choice) => choice !== "deny").map((choice, index) => (
          <Button
            key={choice}
            title={APPROVAL_LABELS[choice]}
            variant={index === 0 ? "primary" : "secondary"}
            onPress={() => onAnswer(request.id, { choice })}
            style={styles.flexButton}
          />
        ))}
      </View>
      <Button title="Deny" variant="danger" onPress={() => onAnswer(request.id, { choice: "deny" })} />
    </Frame>
  );
}

function Clarify({ request, onAnswer }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const p = request.params;
  const questions: { qid: string; question: string; choices?: string[]; multi_select?: boolean }[] =
    Array.isArray(p.questions) && p.questions.length
      ? p.questions
      : [{ qid: "_", question: String(p.question ?? "The agent has a question"), choices: p.choices ?? undefined, multi_select: Boolean(p.multi_select) }];
  const [answers, setAnswers] = useState<Record<string, string>>(p.answers ?? {});
  const set = (qid: string, value: string) => setAnswers((current) => ({ ...current, [qid]: value }));
  const toggle = (qid: string, choice: string) => {
    const selected = new Set((answers[qid] ?? "").split(", ").filter(Boolean));
    if (selected.has(choice)) selected.delete(choice);
    else selected.add(choice);
    set(qid, [...selected].join(", "));
  };
  const complete = questions.every((q) => (answers[q.qid] ?? "").trim());
  const submit = () =>
    questions.length === 1 && questions[0].qid === "_"
      ? onAnswer(request.id, { answer: answers._ })
      : onAnswer(request.id, { answers });
  return (
    <Frame icon="help" title="Needs your input">
      {questions.map((q) => (
        <View key={q.qid} style={{ gap: space.sm }}>
          <Text style={styles.body}>{q.question}</Text>
          {q.choices?.length ? (
            <View style={styles.wrap}>
              {q.choices.map((choice) => (
                <Chip
                  key={choice}
                  label={choice}
                  active={q.multi_select ? (answers[q.qid] ?? "").split(", ").includes(choice) : answers[q.qid] === choice}
                  tint={colors.accentText}
                  onPress={() => (q.multi_select ? toggle(q.qid, choice) : set(q.qid, choice))}
                />
              ))}
            </View>
          ) : null}
          <TextInput
            value={answers[q.qid] ?? ""}
            onChangeText={(value) => set(q.qid, value)}
            placeholder={q.choices?.length ? "Or type your own answer" : "Type your answer"}
            placeholderTextColor={colors.faint}
            style={styles.input}
            multiline
          />
        </View>
      ))}
      <Button title="Send answer" onPress={submit} disabled={!complete} />
    </Frame>
  );
}

function Masked({ request, onAnswer, onDecline }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const p = request.params;
  const [value, setValue] = useState("");
  const config: Record<string, { icon: IconName; title: string; body: string; secure: boolean }> = {
    sudo: { icon: "lock-closed", title: "Administrator password", body: p.command ? `Needed for: ${p.command}` : "The agent needs sudo.", secure: true },
    secret: { icon: "key", title: `Secret: ${p.env_var ?? "value"}`, body: String(p.prompt ?? "Provide a value."), secure: true },
    "vault.code": { icon: "keypad", title: "Verification code", body: `Enter the code${p.site ? ` for ${p.site}` : ""}${p.hint ? ` (${p.hint})` : ""}.`, secure: false },
    "vault.unlock_prompt": { icon: "lock-open", title: `Unlock ${p.display_name ?? "password manager"}`, body: "Master password for this session.", secure: true },
  };
  const c = config[request.method];
  const submit = () => onAnswer(request.id, { value });
  return (
    <Frame icon={c.icon} title={c.title}>
      <Text style={styles.body}>{c.body}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        secureTextEntry={c.secure}
        keyboardType={request.method === "vault.code" ? "number-pad" : "default"}
        textContentType={request.method === "vault.code" ? "oneTimeCode" : request.method === "vault.unlock_prompt" ? "password" : undefined}
        autoComplete={request.method === "vault.code" ? "one-time-code" : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={request.method === "vault.code" ? "Code" : "Value"}
        placeholderTextColor={colors.faint}
        style={styles.input}
        onSubmitEditing={submit}
      />
      <View style={styles.row}>
        <Button title="Cancel" variant="secondary" onPress={() => onDecline(request.id)} style={styles.flexButton} />
        <Button title="Submit" onPress={submit} disabled={!value} style={styles.flexButton} />
      </View>
    </Frame>
  );
}

export const HANDLED_REQUESTS = new Set(["approval", "clarify", "sudo", "secret", "vault.code", "vault.unlock_prompt", "vault.save_login"]);

export function RequestCard(props: Props) {
  const styles = useStyles();
  if (props.request.method === "approval") return <Approval {...props} />;
  if (props.request.method === "clarify") return <Clarify {...props} />;
  if (props.request.method === "vault.save_login") return <LoginRequestCard {...props} />;
  if (HANDLED_REQUESTS.has(props.request.method)) return <Masked {...props} />;
  return (
    <Frame icon="alert" title={`Unsupported request: ${props.request.method}`}>
      <Pressable onPress={() => props.onDecline(props.request.id)}>
        <Text style={styles.body}>Tap to dismiss. Finish this step from Hermes desktop.</Text>
      </Pressable>
    </Frame>
  );
}

const useStyles = makeStyles((colors, type) => ({
  body: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  command: { color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.md },
  row: { flexDirection: "row", gap: space.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  flexButton: { flex: 1, paddingHorizontal: space.sm },
  input: {
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    maxHeight: 120,
  },
}));
