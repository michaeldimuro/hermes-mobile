import React, { useMemo } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { isMediaKind, kindOf } from "@/features/media/kinds";
import type { FileRef } from "@/features/media/source";
import { FileViewer } from "@/features/media/viewer/FileViewer";

/**
 * In-app file viewer: `/viewer?path=<gateway path>&kind=&profile=&session=&name=` for files on the
 * Hermes machine, or `/viewer?url=<https url>&kind=&name=` for remote files.
 */
export default function ViewerScreen() {
  const params = useLocalSearchParams<{
    path?: string;
    url?: string;
    kind?: string;
    profile?: string;
    session?: string;
    name?: string;
  }>();
  const { path, url, profile, session } = params;
  const fileRef = useMemo<FileRef | null>(() => {
    if (path) return { path, profile: profile || null, sessionId: session || null };
    if (url) return { url };
    return null;
  }, [path, url, profile, session]);
  const kind = isMediaKind(params.kind) ? params.kind : kindOf(path || url || "");
  return (
    <>
      <Stack.Screen options={{ animation: "slide_from_bottom", gestureEnabled: true, presentation: "fullScreenModal" }} />
      <FileViewer fileRef={fileRef} kind={kind} name={params.name ?? ""} />
    </>
  );
}
