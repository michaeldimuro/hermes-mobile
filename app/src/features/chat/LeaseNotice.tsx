import React from "react";
import { Alert, Text, View } from "react-native";
import { Button, Icon } from "@/ui/primitives";
import { makeStyles, radius, space, useTheme } from "@/ui/theme";

/** Hermes refuses to run a session another process (usually Hermes desktop's own backend) holds. */
export const isLeaseError = (text?: string) =>
  Boolean(text && /open in another Hermes window/i.test(text));

const SHARE_STEPS =
  "Hermes lets one process own a conversation at a time. Your desktop app runs its own private backend, so it and this phone can't both drive the same chat.\n\n" +
  "To use one conversation on both, run one shared backend:\n" +
  "1. On the Mac, in the Hermes Mobile project: scripts/shared-backend/setup.sh\n" +
  "2. Desktop: Settings → Gateways → Remote gateway → the address it prints; sign in and make it the gateway opened on launch.\n" +
  "3. Sign this phone in to the same address with the same username and password.\n\n" +
  "Then every chat is shared live between desktop and phone.";

export function LeaseNotice({
  text,
  onNewChat,
}: {
  text: string;
  onNewChat?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const details = text.split("\n").find((line) => line.startsWith("Details:"));
  return (
    <View style={styles.lease} accessibilityRole="alert">
      <View style={styles.leaseHead}>
        <Icon name="desktop-outline" size={18} color={colors.warn} />
        <Text style={styles.leaseTitle}>Open in Hermes desktop</Text>
      </View>
      <Text style={styles.leaseBody}>
        Your desktop app is holding this conversation, so the phone can&apos;t
        post to it right now. Nothing was sent.
      </Text>
      <View style={styles.leaseActions}>
        {onNewChat ? (
          <Button
            title="New chat here"
            variant="primary"
            onPress={onNewChat}
            style={styles.leaseButton}
          />
        ) : null}
        <Button
          title="Share with desktop"
          variant="secondary"
          onPress={() =>
            Alert.alert("One conversation, every device", SHARE_STEPS)
          }
          style={styles.leaseButton}
        />
      </View>
      {details ? <Text style={styles.leaseDetails}>{details}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors, type) => ({
  lease: {
    marginVertical: space.sm,
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: `${colors.warn}55`,
  },
  leaseHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  leaseTitle: { ...type.heading },
  leaseBody: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  leaseActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  leaseButton: { flex: 1, minHeight: 42, paddingHorizontal: space.sm },
  leaseDetails: { ...type.small, fontSize: 11, color: colors.faint },
}));
