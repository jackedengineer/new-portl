import {
  Feather,
  type FeatherIconName,
} from '@react-native-vector-icons/feather';
import { colors } from './theme';
export type IconName = FeatherIconName;
export function Icon({
  name,
  size = 21,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
