import { useState, useEffect, useRef } from "react";
import { api } from "../utils/api";
import "./PageStyles.css";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [showNewDir, setShowNewDir] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath]);

  const loadFiles = async (path: string) => {
    const data = await api.listFiles(path);
    setFiles(data);
  };

  const openFile = async (file: FileEntry) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
      setSelectedFile(null);
    } else {
      const data = await api.readFile(file.path);
      setSelectedFile(file.path);
      setFileContent(data.content);
      setEditing(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    await api.writeFile(selectedFile, fileContent);
    setEditing(false);
  };

  const createFile = async () => {
    if (!newFileName) return;
    const filePath = currentPath ? `${currentPath}/${newFileName}` : newFileName;
    await api.writeFile(filePath, "");
    setShowNew(false);
    setNewFileName("");
    loadFiles(currentPath);
  };

  const createDir = async () => {
    if (!newDirName) return;
    const dirPath = currentPath ? `${currentPath}/${newDirName}` : newDirName;
    await api.mkdir(dirPath);
    setShowNewDir(false);
    setNewDirName("");
    loadFiles(currentPath);
  };

  const deleteFile = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    await api.deleteFile(path);
    if (selectedFile === path) {
      setSelectedFile(null);
      setFileContent("");
    }
    loadFiles(currentPath);
  };

  const goUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;
    setUploading(true);
    try {
      for (const file of filesArray) {
        await api.uploadFile(file, currentPath);
      }
      loadFiles(currentPath);
    } catch (err) {
      console.error("Upload failed:", err);
    }
    setUploading(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      uploadFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  return (
    <div className="page-split">
      <div
        className="panel"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="panel-header">
          <h2>Sandbox Files</h2>
          <div className="panel-actions">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
            <button
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowNewDir(true)}>Mkdir</button>
            <button className="btn btn-secondary" onClick={() => setShowNew(true)}>New file</button>
          </div>
        </div>

        <div className="breadcrumb">
          <button className="breadcrumb-item" onClick={() => setCurrentPath("")}>sandbox</button>
          {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
            <span key={i}>
              <span className="breadcrumb-sep">/</span>
              <button className="breadcrumb-item" onClick={() => setCurrentPath(arr.slice(0, i + 1).join("/"))}>
                {part}
              </button>
            </span>
          ))}
        </div>

        {showNewDir && (
          <div className="inline-form">
            <input placeholder="folder-name" value={newDirName} onChange={(e) => setNewDirName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createDir()} autoFocus />
            <button className="btn btn-primary" onClick={createDir}>Create</button>
            <button className="btn btn-ghost" onClick={() => { setShowNewDir(false); setNewDirName(""); }}>Cancel</button>
          </div>
        )}

        {showNew && (
          <div className="inline-form">
            <input placeholder="filename.txt" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFile()} autoFocus />
            <button className="btn btn-primary" onClick={createFile}>Create</button>
            <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        )}

        {currentPath && (
          <div className="file-item" onClick={goUp}>
            <span className="file-icon">↑</span>
            <span className="file-name">..</span>
          </div>
        )}

        <div className="file-list">
          {files.map((file) => (
            <div key={file.name} className={`file-item ${selectedFile === file.path ? "active" : ""}`} onClick={() => openFile(file)}>
              <span className="file-icon">{file.isDirectory ? "📁" : "📄"}</span>
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatSize(file.size)}</span>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); deleteFile(file.path); }}>×</button>
              {!file.isDirectory && (
                <a className="btn btn-ghost btn-sm" href={api.downloadUrl(file.path)} download onClick={(e) => e.stopPropagation()}>↓</a>
              )}
            </div>
          ))}
          {files.length === 0 && !dragOver && <div className="empty-state">No files yet</div>}
        </div>

        {/* Drag overlay */}
        {dragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay-content">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
              </svg>
              <p>Drop files here to upload</p>
            </div>
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="panel editor-panel">
          <div className="panel-header">
            <h3>{selectedFile}</h3>
            <div className="panel-actions">
              {editing ? (
                <>
                  <button className="btn btn-primary" onClick={saveFile}>Save</button>
                  <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn btn-secondary" onClick={() => setEditing(true)}>Edit</button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea className="file-editor" value={fileContent} onChange={(e) => setFileContent(e.target.value)} />
          ) : (
            <pre className="file-preview">{fileContent}</pre>
          )}
        </div>
      )}
    </div>
  );
}
