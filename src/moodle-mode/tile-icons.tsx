import { raw } from 'hono/html'
import academicCap from 'heroicons/24/outline/academic-cap.svg?raw'
import adjustmentsHorizontal from 'heroicons/24/outline/adjustments-horizontal.svg?raw'
import arrowPath from 'heroicons/24/outline/arrow-path.svg?raw'
import arrowUturnLeft from 'heroicons/24/outline/arrow-uturn-left.svg?raw'
import arrowsRightLeft from 'heroicons/24/outline/arrows-right-left.svg?raw'
import beaker from 'heroicons/24/outline/beaker.svg?raw'
import bell from 'heroicons/24/outline/bell.svg?raw'
import bolt from 'heroicons/24/outline/bolt.svg?raw'
import bookOpen from 'heroicons/24/outline/book-open.svg?raw'
import bookmark from 'heroicons/24/outline/bookmark.svg?raw'
import briefcase from 'heroicons/24/outline/briefcase.svg?raw'
import buildingLibrary from 'heroicons/24/outline/building-library.svg?raw'
import buildingOffice from 'heroicons/24/outline/building-office.svg?raw'
import calculator from 'heroicons/24/outline/calculator.svg?raw'
import calendar from 'heroicons/24/outline/calendar.svg?raw'
import calendarDays from 'heroicons/24/outline/calendar-days.svg?raw'
import chartBar from 'heroicons/24/outline/chart-bar.svg?raw'
import chartPie from 'heroicons/24/outline/chart-pie.svg?raw'
import chatBubbleLeft from 'heroicons/24/outline/chat-bubble-left.svg?raw'
import chatBubbleLeftRight from 'heroicons/24/outline/chat-bubble-left-right.svg?raw'
import checkCircle from 'heroicons/24/outline/check-circle.svg?raw'
import clipboardDocumentCheck from 'heroicons/24/outline/clipboard-document-check.svg?raw'
import clipboardDocumentList from 'heroicons/24/outline/clipboard-document-list.svg?raw'
import clock from 'heroicons/24/outline/clock.svg?raw'
import cloudArrowDown from 'heroicons/24/outline/cloud-arrow-down.svg?raw'
import cloudArrowUp from 'heroicons/24/outline/cloud-arrow-up.svg?raw'
import computerDesktop from 'heroicons/24/outline/computer-desktop.svg?raw'
import currencyDollar from 'heroicons/24/outline/currency-dollar.svg?raw'
import currencyEuro from 'heroicons/24/outline/currency-euro.svg?raw'
import currencyPound from 'heroicons/24/outline/currency-pound.svg?raw'
import devicePhoneMobile from 'heroicons/24/outline/device-phone-mobile.svg?raw'
import documentText from 'heroicons/24/outline/document-text.svg?raw'
import exclamationTriangle from 'heroicons/24/outline/exclamation-triangle.svg?raw'
import faceFrown from 'heroicons/24/outline/face-frown.svg?raw'
import faceSmile from 'heroicons/24/outline/face-smile.svg?raw'
import film from 'heroicons/24/outline/film.svg?raw'
import flag from 'heroicons/24/outline/flag.svg?raw'
import globeAlt from 'heroicons/24/outline/globe-alt.svg?raw'
import handRaised from 'heroicons/24/outline/hand-raised.svg?raw'
import handThumbDown from 'heroicons/24/outline/hand-thumb-down.svg?raw'
import handThumbUp from 'heroicons/24/outline/hand-thumb-up.svg?raw'
import heart from 'heroicons/24/outline/heart.svg?raw'
import home from 'heroicons/24/outline/home.svg?raw'
import identification from 'heroicons/24/outline/identification.svg?raw'
import informationCircle from 'heroicons/24/outline/information-circle.svg?raw'
import key from 'heroicons/24/outline/key.svg?raw'
import lifebuoy from 'heroicons/24/outline/lifebuoy.svg?raw'
import lightBulb from 'heroicons/24/outline/light-bulb.svg?raw'
import listBullet from 'heroicons/24/outline/list-bullet.svg?raw'
import magnifyingGlass from 'heroicons/24/outline/magnifying-glass.svg?raw'
import map from 'heroicons/24/outline/map.svg?raw'
import mapPin from 'heroicons/24/outline/map-pin.svg?raw'
import megaphone from 'heroicons/24/outline/megaphone.svg?raw'
import microphone from 'heroicons/24/outline/microphone.svg?raw'
import musicalNote from 'heroicons/24/outline/musical-note.svg?raw'
import newspaper from 'heroicons/24/outline/newspaper.svg?raw'
import numberedList from 'heroicons/24/outline/numbered-list.svg?raw'
import paperAirplane from 'heroicons/24/outline/paper-airplane.svg?raw'
import pencilSquare from 'heroicons/24/outline/pencil-square.svg?raw'
import presentationChartBar from 'heroicons/24/outline/presentation-chart-bar.svg?raw'
import presentationChartLine from 'heroicons/24/outline/presentation-chart-line.svg?raw'
import puzzlePiece from 'heroicons/24/outline/puzzle-piece.svg?raw'
import questionMarkCircle from 'heroicons/24/outline/question-mark-circle.svg?raw'
import rss from 'heroicons/24/outline/rss.svg?raw'
import scale from 'heroicons/24/outline/scale.svg?raw'
import shieldCheck from 'heroicons/24/outline/shield-check.svg?raw'
import sparkles from 'heroicons/24/outline/sparkles.svg?raw'
import speakerWave from 'heroicons/24/outline/speaker-wave.svg?raw'
import square2Stack from 'heroicons/24/outline/square-2-stack.svg?raw'
import squares2x2 from 'heroicons/24/outline/squares-2x2.svg?raw'
import star from 'heroicons/24/outline/star.svg?raw'
import tag from 'heroicons/24/outline/tag.svg?raw'
import trophy from 'heroicons/24/outline/trophy.svg?raw'
import tv from 'heroicons/24/outline/tv.svg?raw'
import user from 'heroicons/24/outline/user.svg?raw'
import users from 'heroicons/24/outline/users.svg?raw'
import viewfinderCircle from 'heroicons/24/outline/viewfinder-circle.svg?raw'
import wrench from 'heroicons/24/outline/wrench.svg?raw'

// タイルの元のアイコン（Font Awesome）を使わないのは、外部のアイコンフォントを読み込まず、ほかの画面と同じ Heroicons にそろえるため
const TILE_ICONS: Record<string, string> = {
  'address-book-o': identification,
  assessment_graded: clipboardDocumentCheck,
  assessment_timer: clock,
  asterisk: sparkles,
  'award-solid': trophy,
  'balance-scale': scale,
  'bar-chart': chartBar,
  'bell-o': bell,
  binoculars: magnifyingGlass,
  bitcoin: currencyDollar,
  book: bookOpen,
  'bookmark-o': bookmark,
  briefcase: briefcase,
  building: buildingOffice,
  bullhorn: megaphone,
  bullseye: viewfinderCircle,
  calculator: calculator,
  calendar: calendar,
  'calendar-check-o': calendarDays,
  check: checkCircle,
  child: user,
  'clock-o': clock,
  clone: square2Stack,
  'cloud-download': cloudArrowDown,
  'cloud-upload': cloudArrowUp,
  'comment-o': chatBubbleLeft,
  'comments-o': chatBubbleLeftRight,
  compass: map,
  diamond: sparkles,
  dollar: currencyDollar,
  euro: currencyEuro,
  'exclamation-triangle': exclamationTriangle,
  feed: rss,
  'file-text-o': documentText,
  film: film,
  'flag-checkered': flag,
  'flag-o': flag,
  flash: bolt,
  flask: beaker,
  flipchart: presentationChartBar,
  'frown-o': faceFrown,
  gavel: scale,
  gbp: currencyPound,
  globe: globeAlt,
  'handshake-o': handRaised,
  headphones: speakerWave,
  heartbeat: heart,
  history: arrowUturnLeft,
  home: home,
  'id-card-o': identification,
  info: informationCircle,
  jigsaw: puzzlePiece,
  key: key,
  laptop: computerDesktop,
  'life-buoy': lifebuoy,
  'lightbulb-o': lightBulb,
  'line-chart': presentationChartLine,
  list: listBullet,
  'list-ol': numberedList,
  'location-arrow': paperAirplane,
  'map-marker': mapPin,
  'map-o': map,
  'map-signs': map,
  microphone: microphone,
  'mobile-phone': devicePhoneMobile,
  'mortar-board': academicCap,
  music: musicalNote,
  'newspaper-o': newspaper,
  'pencil-square-o': pencilSquare,
  person: user,
  'pie-chart': chartPie,
  podcast: microphone,
  'puzzle-piece': puzzlePiece,
  'question-circle': questionMarkCircle,
  random: arrowsRightLeft,
  refresh: arrowPath,
  road: map,
  search: magnifyingGlass,
  sliders: adjustmentsHorizontal,
  'smile-o': faceSmile,
  star: star,
  'star-half-o': star,
  'star-o': star,
  survey: clipboardDocumentList,
  tags: tag,
  tasks: clipboardDocumentCheck,
  television: tv,
  'thinking-person': lightBulb,
  'thumbs-o-down': handThumbDown,
  'thumbs-o-up': handThumbUp,
  trophy: trophy,
  umbrella: shieldCheck,
  university: buildingLibrary,
  'user-o': user,
  users: users,
  'volume-up': speakerWave,
  wrench: wrench,
}

const FALLBACK = squares2x2

/** number_1 〜 number_99 のアイコンは、その数字を出す */
export const tileNumber = (icon: string) => /^number_(\d{1,2})$/.exec(icon)?.[1] ?? null

export const TileIcon = ({ name, size = 28 }: { name: string; size?: number }) =>
  raw((TILE_ICONS[name] ?? FALLBACK).replace('<svg ', `<svg class="icon" width="${size}" height="${size}" `))
