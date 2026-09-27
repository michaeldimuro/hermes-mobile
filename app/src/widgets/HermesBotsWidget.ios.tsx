import { requireOptionalNativeModule } from "expo";
import { HStack, Link, Spacer, Text, VStack, ZStack, Circle } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import type { WidgetEnvironment } from "expo-widgets";

export type WidgetBot = { name: string; title: string; initial: string; color: string };
export type HermesBotsProps = { bots: WidgetBot[] };

/** Home-screen shortcuts: tap a bot to open its conversation, or "Ask" for a new chat. */
const HermesBots = (props: HermesBotsProps, environment: WidgetEnvironment) => {
  "widget";
  const bots = (props.bots ?? []).slice(0, environment.widgetFamily === "systemSmall" ? 2 : 4);
  const avatar = (bot: WidgetBot, size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <Circle modifiers={[foregroundStyle(bot.color)]} />
      <Text modifiers={[font({ size: size * 0.42, weight: "bold" }), foregroundStyle("#FFFFFF")]}>{bot.initial}</Text>
    </ZStack>
  );
  if (environment.widgetFamily === "systemSmall") {
    return (
      <VStack alignment="leading" modifiers={[padding({ all: 4 }), widgetURL("hermes://new")]}>
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#8E8E93")]}>Hermes</Text>
        <Spacer />
        <HStack spacing={8}>
          {bots.map((bot) => (
            <Link key={bot.name} destination={`hermes://bot/${encodeURIComponent(bot.name)}`}>
              {avatar(bot, 36)}
            </Link>
          ))}
        </HStack>
        <Spacer />
        <Text modifiers={[font({ size: 17, weight: "bold" })]}>Ask Hermes</Text>
      </VStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 4 })]}>
      <HStack>
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#8E8E93")]}>Hermes</Text>
        <Spacer />
        <Link destination="hermes://new" label="New chat" modifiers={[font({ size: 13, weight: "semibold" })]} />
      </HStack>
      <HStack spacing={12}>
        {bots.map((bot) => (
          <Link key={bot.name} destination={`hermes://bot/${encodeURIComponent(bot.name)}`}>
            <VStack spacing={4}>
              {avatar(bot, 44)}
              <Text modifiers={[font({ size: 11 })]}>{bot.title}</Text>
            </VStack>
          </Link>
        ))}
      </HStack>
    </VStack>
  );
};

/** Only builds made with the expo-widgets plugin ship its native module (not Expo Go, not older
 *  dev builds): elsewhere the widget is a no-op instead of taking the whole app down at launch. */
const widgets = requireOptionalNativeModule("ExpoWidgets")
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("expo-widgets") as typeof import("expo-widgets"))
  : null;

export default widgets
  ? widgets.createWidget<HermesBotsProps>("HermesBots", HermesBots)
  : { updateSnapshot: (_props: HermesBotsProps) => undefined };
