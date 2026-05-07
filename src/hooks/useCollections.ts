import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnectionStore } from '@/store/connectionStore'
import { listCollections, getCollection, createCollection, deleteCollection, getObjectCount } from '@/lib/weaviate/schema'
import type { WeaviateCollection } from '@/types/domain'
import toast from 'react-hot-toast'

export function useCollections() {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['collections', config?.host],
    queryFn: () => listCollections(config),
    enabled: !!config,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCollection(name: string) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['collection', name, config?.host],
    queryFn: () => getCollection(name, config),
    enabled: !!config && !!name,
  })
}

export function useObjectCount(className: string) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['objectCount', className, config?.host],
    queryFn: () => getObjectCount(className, config),
    enabled: !!config && !!className,
    staleTime: 10_000,
  })
}

export function useCreateCollection() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<WeaviateCollection>) => createCollection(data, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteCollection() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteCollection(name, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
