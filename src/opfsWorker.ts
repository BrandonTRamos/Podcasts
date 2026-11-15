/**
 * The dedicated worker that writes device files, where the OPFS's sync access
 * handles are available. See `opfsFiles.ts`.
 */
import { createFileServer, type FileMessage, type FileReply, type OpfsDirectory } from './opfsFiles'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FileMessage>) => void) | null
  postMessage(reply: FileReply): void
}

const serve = createFileServer(async () => (await navigator.storage.getDirectory()) as unknown as OpfsDirectory)

scope.onmessage = (event) => {
  void serve(event.data).then((reply) => scope.postMessage(reply))
}
