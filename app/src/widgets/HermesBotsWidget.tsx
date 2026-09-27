/** Home-screen widgets are iOS-only (expo-widgets); elsewhere updates are no-ops. */
export type WidgetBot = { name: string; title: string; initial: string; color: string };
export type HermesBotsProps = { bots: WidgetBot[] };

const HermesBotsWidget = { updateSnapshot: (_props: HermesBotsProps) => undefined };
export default HermesBotsWidget;
