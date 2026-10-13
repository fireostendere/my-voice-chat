import { notFound } from 'next/navigation';
import { isShortRoomName } from '@/lib/client-utils';
import RoomPage from '../rooms/[roomName]/page';

export default async function Page(props: Parameters<typeof RoomPage>[0]) {
  const { roomName } = await props.params;
  if (!isShortRoomName(roomName)) notFound();
  return RoomPage(props);
}
