import React from "react";
import { Text, View } from "react-native";
import { BotAvatar } from "@/ui/primitives";
import { makeStyles } from "@/ui/theme";
import type { MemberView } from "./groupEvents";

/** Overlapping member avatars ("facepile"); shows at most `max`, then a "+N" disc. */
export function MemberStack({ members, size = 28, max = 4 }: { members: MemberView[]; size?: number; max?: number }) {
  const styles = useStyles();
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  const overlap = Math.round(size * 0.36);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Members: ${members.map((m) => m.name).join(", ")}`}
    >
      {shown.map((member, i) => (
        <View
          key={member.id}
          style={[styles.ring, { marginLeft: i ? -overlap : 0, borderRadius: size / 2 + 2, zIndex: shown.length - i }]}
        >
          <BotAvatar name={member.profile} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.ring, styles.more, { marginLeft: -overlap, width: size + 4, height: size + 4, borderRadius: size / 2 + 2 }]}>
          <Text style={[styles.moreText, { fontSize: size * 0.36 }]}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center" },
  ring: { borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.bg },
  more: { alignItems: "center", justifyContent: "center", backgroundColor: colors.raised },
  moreText: { color: colors.muted, fontWeight: "700" },
}));
