/**
 * Server-backed profile likes. A like is an account action (it survives
 * reinstalls and tells the other person), so the server list is the truth and
 * the button state comes from it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { key as handleKey } from "@/lib/store";
import { listMyLikes, setProfileLike } from "./notifications.functions";
import { useSignedInUserId } from "./use-notifications";

const likesKey = (userId: string | null) => ["profile-likes", userId] as const;

export function useProfileLike(username: string) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const fetchLikes = useServerFn(listMyLikes);
  const saveLike = useServerFn(setProfileLike);
  const handle = handleKey(username);

  const query = useQuery({
    queryKey: likesKey(userId),
    queryFn: async () => (await fetchLikes()).usernames,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const liked = (query.data ?? []).includes(handle);

  const mutation = useMutation({
    mutationFn: (next: boolean) => saveLike({ data: { peerUsername: handle, liked: next } }),
    onMutate: (next) => {
      queryClient.setQueryData<string[]>(likesKey(userId), (current) => {
        const list = (current ?? []).filter((u) => u !== handle);
        return next ? [...list, handle] : list;
      });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: likesKey(userId) }),
  });

  return {
    liked,
    ready: Boolean(userId) && !query.isLoading,
    toggle: () => mutation.mutateAsync(!liked),
    pending: mutation.isPending,
  };
}
