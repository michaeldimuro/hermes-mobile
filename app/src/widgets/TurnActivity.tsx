/** Live Activities are iOS-only; elsewhere starting one does nothing. */
export type TurnActivityProps = { bot: string; status: string; color: string; done?: boolean };

type Instance = { update: (props: TurnActivityProps) => Promise<void>; end: (...args: unknown[]) => Promise<void> };
const TurnActivity = {
  start: (_props: TurnActivityProps, _url?: string): Instance | null => null,
  getInstances: (): Instance[] => [],
};
export default TurnActivity;
