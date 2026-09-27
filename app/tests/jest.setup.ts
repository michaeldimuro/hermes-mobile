/* Native animation/gesture modules have no JS runtime under Jest; use their official mocks. */
import "react-native-gesture-handler/jestSetup";

jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => {
  const mock = jest.requireActual("react-native-reanimated/mock");
  // The official mock predates the CSS-transition easing helpers; supply the real (pure JS) one.
  const { CubicBezierEasing } = jest.requireActual("react-native-reanimated/src/css/easing/cubicBezier");
  return {
    ...mock,
    cubicBezier: (x1: number, y1: number, x2: number, y2: number) => new CubicBezierEasing(x1, y1, x2, y2),
  };
});
