import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('CampusSync Backend Server is Running!');
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});