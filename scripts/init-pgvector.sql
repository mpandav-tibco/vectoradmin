-- Initialise the vectordb database for use with Vector Admin UI.
-- This script runs once when the postgres container is first created.

CREATE EXTENSION IF NOT EXISTS vector;

-- Sample table — add your own with matching vector dimensions.
-- The adapter detects columns named: embedding, vector, vectors, embeddings.
CREATE TABLE IF NOT EXISTS documents (
  id        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  content   TEXT        NOT NULL DEFAULT '',
  source    TEXT,
  embedding vector(384)             -- adjust to match your embedding model
);

-- Full-text index for keyword search (ilike queries)
CREATE INDEX IF NOT EXISTS documents_content_idx ON documents USING gin(to_tsvector('english', content));

-- Vector similarity search function required by the pgvector adapter.
-- Rename match_<table> to match the table you want to search.
-- Re-run this (or create equivalents) for every table you add.
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector,
  match_count     int
)
RETURNS TABLE (
  id         text,
  content    text,
  source     text,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.source,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE d.embedding IS NOT NULL
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
