import React, { useState } from 'react';

const ResumeUpload = () => {
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    setFiles(e.target.files);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('resumes', files[i]);
    }
    try {
      const res = await fetch('http://localhost:3000/api/resumes', {
        method: 'POST',
        headers: {
          'Idempotency-Key': Date.now().toString()
        },
        body: formData
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError('Upload failed');
    }
  };

  return (
    <div style={{padding:20}}>
      <h2>Upload Resumes (PDF/DOC/ZIP)</h2>
      <form onSubmit={handleSubmit}>
        <input type="file" name="resumes" multiple onChange={handleChange} />
        <button type="submit">Upload</button>
      </form>
      {error && <div style={{color:'red'}}>{error}</div>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
};

export default ResumeUpload;
