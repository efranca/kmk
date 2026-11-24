import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "../session";
import {
  createCategory, createDocument, deleteCategory, deleteDocument, listDocuments, updateCategory, updateDocument, uploadFile,
  type DocumentInput,
} from "./api";

const KEY = ["documents"] as const;

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
        if (file) await uploadFile(id, file.blob, file.name, csrfToken, onProgress);
        return id;
      }
      const created = await createDocument(input, csrfToken);
      try {
        if (file) await uploadFile(created.id, file.blob, file.name, csrfToken, onProgress);
      } catch (error) {
        await deleteDocument(created.id, csrfToken).catch(() => undefined); // the server also purges pending ones after an hour
        throw error;
      }
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
