import { requireOptionalNativeModule } from "expo";
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityEnvironment, LiveActivityFactory } from "expo-widgets";

export type TurnActivityProps = { bot: string; status: string; color: string; done?: boolean };

/** A bot working on your message: Lock Screen banner + Dynamic Island while the turn runs. */
const TurnActivity = (props: TurnActivityProps, environment: LiveActivityEnvironment) => {
  "widget";
  const tint = environment.isLuminanceReduced ? "#FFFFFF" : props.color;
  const icon = props.done ? "checkmark.circle.fill" : "ellipsis.bubble.fill";
  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 14 })]}>
        <Image systemName={icon} color={tint} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ weight: "bold", size: 15 })]}>{props.bot}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle("#8E8E93")]}>{props.status}</Text>
        </VStack>
        <Spacer />
      </HStack>
    ),
    compactLeading: <Image systemName={icon} color={tint} />,
    compactTrailing: <Text modifiers={[font({ size: 12 })]}>{props.done ? "Done" : props.bot}</Text>,
    minimal: <Image systemName={icon} color={tint} />,
    expandedLeading: <Image systemName={icon} color={tint} />,
    expandedCenter: <Text modifiers={[font({ weight: "bold", size: 15 })]}>{props.bot}</Text>,
    expandedBottom: <Text modifiers={[font({ size: 13 }), foregroundStyle("#8E8E93")]}>{props.status}</Text>,
  };
};

/** Only builds made with the expo-widgets plugin ship its native module (not Expo Go, not older
 *  dev builds): elsewhere the widget is a no-op instead of taking the whole app down at launch. */
const widgets = requireOptionalNativeModule("ExpoWidgets")
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("expo-widgets") as typeof import("expo-widgets"))
  : null;

const noop = {
  start: (_props: TurnActivityProps, _url?: string) => null,
  getInstances: () => [],
} as unknown as LiveActivityFactory<TurnActivityProps>;

export default widgets ? widgets.createLiveActivity<TurnActivityProps>("TurnActivity", TurnActivity) : noop;
