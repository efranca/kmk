import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import { makePreview } from "./previews";
import {
  createCategory, createDocument, deleteCategory, deleteDocument, listDocuments, updateCategory, updateDocument, uploadFile, uploadPreview,
  type DocumentInput,
} from "./api";

const KEY = ["documents"] as const;

/** The tiles view's small picture. Best effort: with no preview the tile shows an icon, and the upload is already done. */
async function sendPreview(id: number, file: Blob, csrf: string): Promise<void> {
  try {
    const preview = await makePreview(file as File);
    if (preview) await uploadPreview(id, preview, csrf);
  } catch {
    // ignored on purpose
  }
}

export function useDocuments() {
  return useQuery({ queryKey: KEY, queryFn: listDocuments });
}

export function useDeleteDocument() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteDocument(id, csrfToken), onSuccess: () => client.invalidateQueries({ queryKey: KEY }) });
}

/**
 * Adds a document: its details first, then the file. If the file is refused or the connection drops, the half-made
 * document is deleted, so nothing is left behind. Changing a document may replace its file too.
 */
export function useSaveDocument() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input, file, onProgress }: { id?: number; input: DocumentInput; file?: { blob: Blob; name: string }; onProgress?: (f: number) => void }) => {
      if (id !== undefined) {
        await updateDocument(id, input, csrfToken);
        if (file) {
          await uploadFile(id, file.blob, file.name, csrfToken, onProgress);
          await sendPreview(id, file.blob, csrfToken);
        }
        return id;
      }
      const created = await createDocument(input, csrfToken);
      try {
        if (file) await uploadFile(created.id, file.blob, file.name, csrfToken, onProgress);
      } catch (error) {
        await deleteDocument(created.id, csrfToken).catch(() => undefined); // the server also purges pending ones after an hour
        throw error;
      }
      if (file) await sendPreview(created.id, file.blob, csrfToken);
      return created.id;
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveDocumentCategory() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: { name: string; icon: string | null } }) =>
      id === undefined ? createCategory(input, csrfToken) : updateCategory(id, input, csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteDocumentCategory() {
  const { csrfToken } = useSession();
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteCategory(id, csrfToken), onSuccess: () => client.invalidateQueries({ queryKey: KEY }) });
}
