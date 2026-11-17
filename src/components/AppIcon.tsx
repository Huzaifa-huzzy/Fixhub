import {
  BadgeCheck,
  ArrowLeft,
  ArrowRight,
  Bell,
  EllipsisVertical,
  FileText,
  Flag,
  Hammer,
  Info,
  LocateFixed,
  LogOut,
  MapPin,
  MessageCircle,
  Paintbrush,
  Pencil,
  Plus,
  Search,
  Snowflake,
  Sparkles,
  Star,
  Store,
  Trash2,
  UserRound,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

const icons = {
  badgeCheck: BadgeCheck,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  bell: Bell,
  more: EllipsisVertical,
  document: FileText,
  flag: Flag,
  hammer: Hammer,
  info: Info,
  locateFixed: LocateFixed,
  logOut: LogOut,
  mapPin: MapPin,
  messageCircle: MessageCircle,
  paintbrush: Paintbrush,
  pencil: Pencil,
  plus: Plus,
  search: Search,
  snowflake: Snowflake,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  trash: Trash2,
  user: UserRound,
  wrench: Wrench,
  x: X,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof icons;

export function AppIcon({
  name,
  size = 18,
  color = '#17332B',
  strokeWidth = 2,
  fill = 'none',
}: {
  name: AppIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  const Icon = icons[name];
  return <Icon color={color} fill={fill} size={size} strokeWidth={strokeWidth} />;
}
