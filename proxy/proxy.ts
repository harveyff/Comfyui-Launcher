import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const port = 8000;

// app.use('/', createProxyMiddleware({ target: 'https://7e6098941.xuejingjie089.olares.cn/', changeOrigin: true }));
app.use('/', createProxyMiddleware({ target: 'http://localhost:3000', changeOrigin: true }));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});