import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useConnectionStore } from '@/store/connectionStore'
import { listObjects, getObject, createObject, updateObject, deleteObject, batchUpsert } from '@/lib/weaviate/objects'
import type { WeaviateObject } from '@/types/domain'
import toast from 'react-hot-toast'

export function useObjects(className: string, limit = 25, offset = 0) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['objects', className, limit, offset, config?.host],
    queryFn: () => listObjects(className, { limit, offset }, config),
    enabled: !!config && !!className,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

export function useObject(className: string, id: string) {
  const config = useConnectionStore((s) => s.config)
  return useQuery({
    queryKey: ['object', className, id, config?.host],
    queryFn: () => getObject(className, id, true, config),
    enabled: !!config && !!className && !!id,
  })
}

export function useCreateObject() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (obj: { class: string; properties: Record<string, unknown>; id?: string; vector?: number[] }) =>
      createObject(obj, config),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.class] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.class] })
      toast.success('Object created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateObject() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ className, id, properties }: { className: string; id: string; properties: Record<string, unknown> }) =>
      updateObject(className, id, properties, config),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['object', vars.className, vars.id] })
      toast.success('Object updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteObject() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ className, id }: { className: string; id: string }) => deleteObject(className, id, config),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.className] })
      toast.success('Object deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useBatchUpsert() {
  const config = useConnectionStore((s) => s.config)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ className, objects }: {
      className: string
      objects: Array<{ class: string; properties: Record<string, unknown>; id?: string; vector?: number[] }>
    }) => batchUpsert(objects, config),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ['objects', vars.className] })
      qc.invalidateQueries({ queryKey: ['objectCount', vars.className] })
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} errors during batch import`)
      } else {
        toast.success(`${result.success} objects imported`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
