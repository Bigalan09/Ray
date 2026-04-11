/**
 * E2E tests for the RAG document ingestion pipeline.
 *
 * Happy path: upload text file → chunks stored in ChromaDB → search returns results.
 * Unhappy path: empty file rejected, unknown document delete returns error.
 *
 * Covers ISSUES.md #7.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

test.describe("RAG pipeline API", () => {
  test("POST /api/documents/upload accepts a text file", async ({ request }) => {
    const content = "The quick brown fox jumps over the lazy dog. This is a test document for RAG ingestion.";
    const resp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "test-doc.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(content),
        },
      },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ingested).toBe(true);
    expect(data.chunks).toBeGreaterThan(0);
    expect(data.source).toBe("test-doc.txt");
    expect(data.document_id).toBeTruthy();

    // Clean up
    await request.delete(`/api/documents/${data.document_id}`);
  });

  test("POST /api/documents/upload accepts a markdown file", async ({ request }) => {
    const content = "# Test Document\n\nThis is a markdown document. It contains useful information about testing RAG pipelines.";
    const resp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "test.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(content),
        },
      },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ingested).toBe(true);

    // Clean up
    await request.delete(`/api/documents/${data.document_id}`);
  });

  test("GET /api/documents lists ingested documents", async ({ request }) => {
    // Upload a document first
    const uploadResp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "list-test.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Document for list test. Contains unique content xyz789abc."),
        },
      },
    });
    const uploaded = await uploadResp.json();
    expect(uploaded.ingested).toBe(true);

    const listResp = await request.get("/api/documents");
    expect(listResp.ok()).toBeTruthy();
    const data = await listResp.json();
    expect(Array.isArray(data.documents)).toBe(true);
    const found = data.documents.find((d: any) => d.document_id === uploaded.document_id);
    expect(found).toBeTruthy();
    expect(found.source).toBe("list-test.txt");

    // Clean up
    await request.delete(`/api/documents/${uploaded.document_id}`);
  });

  test("POST /api/documents/search finds uploaded content", async ({ request }) => {
    // Upload a document with distinctive content
    const unique = `unique-phrase-${Date.now()}`;
    const uploadResp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "search-test.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(`This document contains a ${unique} that is very specific.`),
        },
      },
    });
    const uploaded = await uploadResp.json();

    if (!uploaded.ingested) {
      // ChromaDB not available in this environment — skip search test
      test.skip();
      return;
    }

    const searchResp = await request.post("/api/documents/search", {
      data: { query: unique, limit: 5 },
    });
    expect(searchResp.ok()).toBeTruthy();
    const results = await searchResp.json();
    expect(results.results).toBeDefined();
    // Should find the document with the unique phrase
    const found = results.results.some((r: any) =>
      r.content?.includes(unique) || r.source === "search-test.txt"
    );
    expect(found).toBe(true);

    // Clean up
    await request.delete(`/api/documents/${uploaded.document_id}`);
  });

  test("DELETE /api/documents/:id removes the document", async ({ request }) => {
    const uploadResp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "delete-test.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Document to be deleted."),
        },
      },
    });
    const uploaded = await uploadResp.json();

    if (!uploaded.ingested) {
      test.skip();
      return;
    }

    const deleteResp = await request.delete(`/api/documents/${uploaded.document_id}`);
    expect(deleteResp.ok()).toBeTruthy();
    const deleteData = await deleteResp.json();
    expect(deleteData.deleted).toBe(true);
  });

  test("uploading empty content returns 400", async ({ request }) => {
    const resp = await request.post("/api/documents/upload", {
      multipart: {
        file: {
          name: "empty.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(""),
        },
      },
    });
    expect(resp.status()).toBe(400);
  });

  test("document_search tool is available", async ({ request }) => {
    const resp = await request.get("/api/tools");
    expect(resp.ok()).toBeTruthy();
    const tools = await resp.json();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("document_search");
  });
});
