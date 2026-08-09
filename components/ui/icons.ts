/**
 * THE ICON PALETTE — the single, closed vocabulary of icons for the whole app.
 *
 * RULES
 *  1. Nothing outside this file may import from "lucide-react". ESLint enforces
 *     it (`no-restricted-imports`), so a stray import fails lint, not review.
 *  2. Every icon is imported from here BY MEANING, not by glyph:
 *         import { EditIcon, DeleteIcon } from "@/components/ui/icons";
 *     A screen asks for "edit", not for "a pencil". If the pencil ever changes,
 *     it changes once, here, and every page changes with it.
 *  3. One meaning = one glyph. Synonyms were collapsed on the way in (Pencil and
 *     PencilLine both became EditIcon; four circular arrows became RefreshIcon).
 *     Adding a second glyph for a meaning that already exists re-opens the drift
 *     this file was created to close.
 *  4. Need an icon for something new? Look below first — the palette carries a
 *     deliberate reserve for features we haven't built yet, so the answer is
 *     usually already here. If it genuinely isn't, add ONE line to the right
 *     group, named for the meaning. Never reach past the palette.
 *
 * ONE VISUAL STYLE
 *   Every glyph is a lucide outline icon: 24×24 box, 2px stroke, round caps and
 *   joins, no fills. That is why they sit together without looking assembled
 *   from different sets — and it is why a filled or two-tone icon from anywhere
 *   else must not be added. Size with `className="h-4 w-4"`; `Button` already
 *   sizes any svg it contains, so icon-only buttons need no class at all.
 *
 * THE ONE EXCEPTION: brand marks. Waze is a recognizable logo, not a generic
 *   "directions arrow", and it is deliberately kept — see WazeIcon below.
 *
 * DIRECTIONAL ICONS keep geometric names (ChevronLeftIcon, ArrowRightIcon…)
 * on purpose: the app is RTL, so "left" and "back" are not the same thing and
 * a semantic name would lie at half the call sites.
 */

export type { LucideIcon as IconComponent } from "lucide-react";

/* ── Brand marks ──────────────────────────────────────────────────────────
   The only non-lucide glyphs in the palette, and only because a logo cannot be
   swapped for a generic shape without losing its meaning. Waze IS navigation in
   this app — every address links to it — so a compass or arrow is never the
   right substitute. Solid `currentColor` fill by design, sized like a lucide
   icon so it drops into the same rows. */
export { WazeIcon } from "@/components/ui/waze-icon";

/* ── Core actions ─────────────────────────────────────────────────────────
   The CRUD verbs. EditIcon and DeleteIcon are the two most-repeated controls in
   the app and are ALWAYS icon-only — use `EditButton` / `DeleteButton` from
   components/ui/icon-button.tsx rather than rebuilding them. */
export {
  Pencil as EditIcon,
  Trash2 as DeleteIcon,
  Plus as AddIcon,
  Minus as RemoveIcon,
  X as CloseIcon,
  Check as CheckIcon,
  Save as SaveIcon,
  Copy as CopyIcon,
  Split as SplitIcon,
  Move as MoveIcon,
  Archive as ArchiveIcon,
  ArchiveRestore as UnarchiveIcon,
  Undo2 as UndoIcon,
  Delete as BackspaceIcon,
  Eraser as ClearIcon,
  CheckCheck as AllDoneIcon,
  ListPlus as AddListItemIcon,
  Recycle as RestoreIcon,
} from "lucide-react";

/* ── State and feedback ─────────────────────────────────────────────────── */
export {
  CheckCircle2 as SuccessIcon,
  CircleX as ErrorIcon,
  AlertTriangle as WarningIcon,
  Info as InfoIcon,
  CircleHelp as HelpIcon,
  Ban as BlockedIcon,
  Hourglass as PendingIcon,
  Circle as UncheckedIcon,
  CheckSquare as CheckboxCheckedIcon,
  Square as StopIcon,
  ToggleRight as ToggleOnIcon,
  ToggleLeft as ToggleOffIcon,
  Loader2 as SpinnerIcon,
} from "lucide-react";

/* ── Finding things ─────────────────────────────────────────────────────── */
export {
  Search as SearchIcon,
  SearchX as NoResultsIcon,
  SlidersHorizontal as FilterIcon,
  FilterX as ClearFilterIcon,
  ArrowUpDown as SortIcon,
  /** Refresh, retry, regenerate and reset-to-default all share one glyph. */
  RotateCw as RefreshIcon,
  GripVertical as DragIcon,
  MoreVertical as MoreIcon,
  Layers as LayersIcon,
  ScanLine as ScanIcon,
  QrCode as QrCodeIcon,
  Barcode as BarcodeIcon,
} from "lucide-react";

/* ── Files, sharing, capture ────────────────────────────────────────────── */
export {
  Upload as UploadIcon,
  Download as DownloadIcon,
  CloudUpload as SyncIcon,
  Paperclip as AttachIcon,
  Camera as CameraIcon,
  Mic as MicIcon,
  Video as VideoIcon,
  ImageIcon,
  Images as GalleryIcon,
  Printer as PrintIcon,
  Share2 as ShareIcon,
  ExternalLink as ExternalLinkIcon,
  Send as SendIcon,
  Link2 as LinkIcon,
  Unlink as UnlinkIcon,
} from "lucide-react";

/* ── Direction and layout (geometric by design — see the RTL note above) ── */
export {
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsLeft as ChevronsLeftIcon,
  ChevronsRight as ChevronsRightIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  ArrowLeftRight as TransferIcon,
  CornerDownLeft as EnterIcon,
  Menu as MenuIcon,
  LayoutGrid as GridIcon,
  Table2 as TableIcon,
  Maximize2 as ExpandIcon,
  Minimize2 as CollapseIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from "lucide-react";

/* ── People ─────────────────────────────────────────────────────────────── */
export {
  UserRound as UserIcon,
  Users as UsersIcon,
  UserPlus as AddUserIcon,
  UserMinus as RemoveUserIcon,
  UserCheck as ApprovedUserIcon,
  UserX as BlockedUserIcon,
  Contact as ContactCardIcon,
  IdCard as IdCardIcon,
  Baby as ChildIcon,
} from "lucide-react";

/* ── Access, identity, settings ─────────────────────────────────────────── */
export {
  Settings as SettingsIcon,
  Lock as LockIcon,
  Unlock as UnlockIcon,
  KeyRound as KeyIcon,
  Shield as ShieldIcon,
  ShieldCheck as AdminIcon,
  ShieldAlert as SecurityAlertIcon,
  Fingerprint as FingerprintIcon,
  Eye as ShowIcon,
  EyeOff as HideIcon,
  LogIn as LoginIcon,
  LogOut as LogoutIcon,
  Sparkles as AiIcon,
  Palette as ColorIcon,
  Sun as LightModeIcon,
  Moon as DarkModeIcon,
  Languages as LanguageIcon,
} from "lucide-react";

/* ── Business entities (one per section of the app, mostly) ─────────────── */
export {
  LayoutDashboard as DashboardIcon,
  FolderKanban as ProjectIcon,
  FolderOpen as FolderIcon,
  FolderPlus as AddFolderIcon,
  ListTodo as TaskIcon,
  ListChecks as ChecklistIcon,
  ClipboardList as ClipboardIcon,
  ClipboardCheck as ChecklistDoneIcon,
  NotebookPen as NotebookIcon,
  List as ListIcon,
  AlignLeft as TextIcon,
  ShoppingCart as OrderIcon,
  ShoppingBag as PurchaseIcon,
  Tag as TagIcon,
  Handshake as DealIcon,
  Signature as SignatureIcon,
  Stamp as StampIcon,
  Building2 as BuildingIcon,
  Home as HomeIcon,
  Hotel as PropertyIcon,
  Store as StoreIcon,
  Factory as FactoryIcon,
  Briefcase as BusinessIcon,
  Hammer as LaborIcon,
  Wrench as ServiceIcon,
  HandHeart as CharityIcon,
  GraduationCap as EducationIcon,
  Gift as GiftIcon,
  Cake as BirthdayIcon,
  Coffee as BreakIcon,
  Award as AwardIcon,
  Target as GoalIcon,
} from "lucide-react";

/* ── Documents ──────────────────────────────────────────────────────────── */
export {
  FileText as DocumentIcon,
  Files as DocumentsIcon,
  FilePlus as AddDocumentIcon,
  FileCheck as ApprovedDocumentIcon,
  FileX as RejectedDocumentIcon,
  FileSignature as ContractIcon,
  FileSpreadsheet as SpreadsheetIcon,
  FileDown as ExportIcon,
  FileUp as ImportIcon,
  FileBarChart as ReportIcon,
  ScrollText as LedgerIcon,
  StickyNote as NoteIcon,
  BookOpen as BookIcon,
} from "lucide-react";

/* ── Inventory and logistics ────────────────────────────────────────────── */
export {
  Package as ProductIcon,
  PackagePlus as AddProductIcon,
  PackageMinus as StockDownIcon,
  PackageCheck as StockInIcon,
  PackageX as StockOutIcon,
  PackageSearch as FindProductIcon,
  Boxes as InventoryIcon,
  Warehouse as WarehouseIcon,
  Container as ContainerIcon,
  Truck as DeliveryIcon,
  Car as VehicleIcon,
  Fuel as FuelIcon,
  Ruler as MeasureIcon,
  Weight as WeightIcon,
} from "lucide-react";

/* ── Money ──────────────────────────────────────────────────────────────── */
export {
  Wallet as WalletIcon,
  Banknote as CashIcon,
  Coins as CoinsIcon,
  HandCoins as PaymentIcon,
  CreditCard as CardIcon,
  Receipt as ReceiptIcon,
  Landmark as BankIcon,
  PiggyBank as SavingsIcon,
  Calculator as CalculatorIcon,
  Scale as BalanceIcon,
  Percent as VatIcon,
  BadgePercent as DiscountIcon,
  Sigma as SumIcon,
  ArrowDownCircle as IncomeIcon,
  ArrowUpCircle as ExpenseIcon,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
  BarChart3 as ChartIcon,
  LineChart as TrendChartIcon,
  ChartPie as PieChartIcon,
  Gauge as GaugeIcon,
} from "lucide-react";

/* ── Time ───────────────────────────────────────────────────────────────── */
export {
  CalendarDays as CalendarIcon,
  CalendarClock as ScheduleIcon,
  CalendarCheck as CalendarCheckIcon,
  CalendarPlus as AddDateIcon,
  CalendarMinus as RemoveDateIcon,
  CalendarX as CancelDateIcon,
  CalendarRange as DateRangeIcon,
  Clock as ClockIcon,
  Timer as TimerIcon,
  AlarmClock as AlarmIcon,
  History as HistoryIcon,
  Activity as ActivityIcon,
  Repeat as RecurringIcon,
  Shuffle as ShuffleIcon,
  PlayCircle as PlayIcon,
  Milestone as MilestoneIcon,
} from "lucide-react";

/* ── Contact ────────────────────────────────────────────────────────────── */
export {
  Phone as PhoneIcon,
  PhoneCall as PhoneCallIcon,
  PhoneIncoming as PhoneInIcon,
  PhoneOutgoing as PhoneOutIcon,
  PhoneMissed as MissedCallIcon,
  PhoneOff as PhoneOffIcon,
  Voicemail as VoicemailIcon,
  /** WhatsApp links and conversation surfaces. */
  MessageCircle as ChatIcon,
  /** A comment written inside the app (task comments, internal notes). */
  MessageSquare as CommentIcon,
  MessagesSquare as ThreadIcon,
  Mail as MailIcon,
  MailOpen as MailOpenIcon,
  AtSign as AtSignIcon,
  Reply as ReplyIcon,
  Forward as ForwardIcon,
  Inbox as InboxIcon,
  Megaphone as AnnouncementIcon,
  /** Where a place IS. To NAVIGATE to it, use WazeIcon. */
  MapPin as LocationIcon,
  MapPinned as SavedLocationIcon,
  Route as RouteIcon,
  Globe as GlobeIcon,
} from "lucide-react";

/* ── Alerts and reminders ───────────────────────────────────────────────── */
export {
  Bell as NotificationIcon,
  BellRing as ReminderIcon,
  BellOff as NotificationOffIcon,
  BellPlus as AddReminderIcon,
  BellDot as UnreadNotificationIcon,
  Pin as PinIcon,
  Star as StarIcon,
  Flag as FlagIcon,
  Bookmark as BookmarkIcon,
} from "lucide-react";

/* ── Devices and system ─────────────────────────────────────────────────── */
export {
  Smartphone as MobileIcon,
  Tablet as TabletIcon,
  Monitor as DesktopIcon,
  Laptop as LaptopIcon,
  WifiOff as OfflineIcon,
  Cloud as CloudIcon,
  Database as DatabaseIcon,
  Server as ServerIcon,
  Network as NetworkIcon,
  HardDrive as BackupIcon,
  Terminal as TerminalIcon,
  Code as CodeIcon,
  Bug as BugIcon,
  Power as PowerIcon,
  Zap as ElectricityIcon,
  Droplet as WaterIcon,
  Flame as GasIcon,
} from "lucide-react";
