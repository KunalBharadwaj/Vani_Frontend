# Storage Backend Setup

## Features Implemented

✅ **File Upload** - Upload drawings to Supabase Storage
✅ **File Download** - Download drawings from cloud
✅ **File Listing** - View all saved drawings
✅ **File Deletion** - Remove drawings from cloud
✅ **Auto-save to Cloud** - Automatically uploads when saving

## Storage Service Functions

### `uploadFile(file, fileName)`

Upload any file to cloud storage

```javascript
const result = await uploadFile(file, "my-drawing.png");
if (result.success) {
  console.log("File URL:", result.url);
}
```

### `uploadCanvas(canvas, fileName)`

Upload canvas element directly

```javascript
const result = await uploadCanvas(canvasRef.current);
if (result.success) {
  console.log("Uploaded:", result.url);
}
```

### `listFiles(folder)`

Get all files from storage

```javascript
const result = await listFiles();
if (result.success) {
  console.log("Files:", result.files);
}
```

### `deleteFile(filePath)`

Delete a file from storage

```javascript
const result = await deleteFile("drawing-123.png");
```

### `downloadFile(filePath)`

Download file as blob

```javascript
const result = await downloadFile("drawing-123.png");
if (result.success) {
  // Use result.blob
}
```

### `getPublicUrl(filePath)`

Get public URL for a file

```javascript
const url = getPublicUrl("drawing-123.png");
```

## Supabase Storage Setup

### 1. Create Storage Bucket

The app automatically creates a `drawings` bucket on first run, but you can also create it manually in Supabase dashboard:

1. Go to your Supabase project: https://supabase.com/dashboard
2. Navigate to Storage
3. Click "Create a new bucket"
4. Name: `drawings`
5. Public bucket: ✅ Yes
6. File size limit: 10MB
7. Allowed MIME types: `image/png`, `image/jpeg`, `image/jpg`

### 2. Set Storage Policies (Optional)

For public access without authentication:

```sql
-- Allow public uploads
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'drawings');

-- Allow public downloads
CREATE POLICY "Allow public downloads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'drawings');

-- Allow public deletes
CREATE POLICY "Allow public deletes"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'drawings');
```

## Usage in Components

### In PaintCanvas

```javascript
import { uploadCanvas } from "@/services/storageService";

const handleSave = async () => {
  const result = await uploadCanvas(canvasRef.current);
  if (result.success) {
    console.log("Saved to cloud:", result.url);
  }
};
```

### Using CloudGallery Component

```javascript
import { CloudGallery } from "@/components/paint/CloudGallery";

<CloudGallery
  onLoadDrawing={(url) => {
    // Load drawing from URL
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = url;
  }}
/>;
```

## Environment Variables

Make sure these are set in your `.env` file:

```
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

## File Structure

```
src/
├── services/
│   └── storageService.js      # Main storage service
├── components/
│   └── paint/
│       ├── PaintCanvas.jsx    # Canvas with cloud save
│       └── CloudGallery.jsx   # View/manage cloud files
```

## Error Handling

All functions return `{ success: boolean, error?: any }` format for consistent error handling:

```javascript
const result = await uploadFile(file);
if (!result.success) {
  console.error("Upload failed:", result.error);
  toast.error("Failed to upload");
}
```
