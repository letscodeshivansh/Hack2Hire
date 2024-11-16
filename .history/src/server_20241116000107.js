const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const mongoose = require('mongoose');
const { Profile, Task, User, Message, Post } = require('./mongodb');
const { check, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const { PythonShell } = require("python-shell");
const { v4: uuidv4 } = require('uuid');  // To generate unique user IDs

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const sessionMiddleware = session({
  secret: 'secretkey',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 365 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

// for authentication
function isAuthenticated(req, res, next) {
  if (req.session.userID) {  // Updated to check userID instead of username
    return next();
  }
  res.redirect('/login');
}

io.use(require('express-socket.io-session')(sessionMiddleware, {
  autoSave: true
}));

const parentDir = path.join(__dirname, '../');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.set('views', path.join(parentDir, 'templates'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(parentDir, 'public')));
app.use(express.static(path.join(parentDir, 'assets')));

app.get('/', isAuthenticated, async (req, res) => {
  res.render('landing');
});

app.get('/aboutus', (req, res) => {
  res.render("aboutus");
});

// Home page after logging in
app.get('/index', async (req, res) => {
  try {
    const userID = req.session.userID;
    const tasks = await Task.find();
    const posts = await Post.find();

    res.render('index', { userID, tasks, posts });
  } catch (error) {
    console.error('Error loading index page:', error);
    res.status(500).send('Error loading page');
  }
});

app.get("/chatroom", isAuthenticated, async (req, res) => {
  const userID = req.session.userID;

  if (!userID) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const tasks = await Task.find({ taskOwner: userID });
    const messages = await Message.find({ receiver: userID });

    res.render("chatroom", { tasks, messages, userID });
  } catch (error) {
    console.error("Error fetching chatroom data:", error);
    res.status(500).send("Error fetching chatroom data");
  }
});

app.get("/chat/:taskId", async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).send("Task not found");
    }

    const taskOwner = task.taskOwner;
    const userID = req.session.userID;

    res.render("chat", { taskOwner, userID, taskId });
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).send("Error fetching task");
  }
});

app.get('/chat.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.js'));
});

let socketsConnected = new Set();

io.on('connection', onConnected);

function onConnected(socket) {
  console.log('Socket connected', socket.id);
  socketsConnected.add(socket.id);
  io.emit('clients-total', socketsConnected.size);

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
    socketsConnected.delete(socket.id);
    io.emit('clients-total', socketsConnected.size);
  });

  socket.on('message', async (data) => {
    console.log('Received message data:', data);

    const message = new Message({
      taskId: data.taskId,
      sender: data.sender,
      receiver: data.receiver,
      message: data.message,
      dateTime: data.dateTime,
    });

    try {
      await message.save();
      socket.broadcast.emit('chat-message', data);
    } catch (error) {
      console.error('Error saving message to database:', error);
    }
  });

  socket.on('feedback', (data) => {
    socket.broadcast.emit('feedback', data);
  });
}

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).render('login', { error: 'Invalid username or password' });
    }

    req.session.userID = uuidv4();  // Generate unique userID upon login
    req.session.username = username;
    res.redirect('/index');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error logging in');
  }
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', [
  check('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters long'),
  check('password').isLength({ min: 5 }).withMessage('Password must be at least 5 characters long')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('signup', { error: errors.array()[0].msg });
  }

  try {
    const { username, password } = req.body;
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.status(400).render('signup', { error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    req.session.userID = uuidv4();  // Assign unique userID upon signup
    req.session.username = username;
    res.redirect('/index');
  } catch (error) {
    console.error(error);
    res.status(500).render('signup', { error: 'An error occurred during signup. Please try again.' });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    },
  }),
});

app.post('/postwork', upload.array('images', 5), async (req, res) => {
  try {
    const { title, description, deadline, price } = req.body;
    const imageUrls = req.files.map((file) => '/uploads/' + file.filename);
    const taskOwner = req.session.userID;

    const taskAdded = new Task({
      title,
      description,
      deadline,
      price,
      images: imageUrls,
      taskOwner,
    });

    await taskAdded.save();

    res.redirect('/index');
  } catch (error) {
    console.error('Error adding task:', error);
    res.status(500).send('Error adding task');
  }
});

app.get('/postwork', isAuthenticated, async (req, res) => {
  try {
    const tasks = await Task.find();
    const userID = req.session.userID;
    res.render('postwork', { tasks, userID });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).send('Error fetching tasks');
  }
});

// Route to render post sharing page
app.get('/postshare', (req, res) => {
  const loggedInUsername = req.session.userID;
  if (!loggedInUsername) {
    return res.redirect('/login'); 
  }
  res.render('postshare', { loggedInUsername });
});


app.post('/postshare', upload.single('image'), async (req, res) => {
  try {
    const { caption } = req.body;
    const author = req.session.userID;

    let imageUrl = '';
    if (req.file) {
      imageUrl = '/uploads/' + req.file.filename;
    }

    const newPost = new Post({
      caption,
      imageUrl,
      author,
    });

    await newPost.save();
    res.redirect('/index');
  } catch (error) {
    console.error('Error sharing post:', error);
    res.status(500).send('Error sharing post');
  }
});

// Route for rendering the chat interface
app.get("/askai", (req, res) => {
  res.render("askai");
});

app.post("/askai", (req, res) => {
  const question = req.body.question;

  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  console.log("Received question:", question); // Debugging

  let options = {
    mode: "text",
    pythonOptions: ["-u"],
    scriptPath: path.join(__dirname, '..'),  // Ensure this is correct
    args: [question]
  };

  PythonShell.run("askai.py", options, (err, result) => {
    if (err) {
      console.error("Error in PythonShell:", err);
      return res.status(500).json({ error: "AI response error" });
    }

    if (!result || result.length === 0) {
      console.error("Empty response from Python script");
      return res.status(500).json({ error: "Empty response from AI" });
    }

    console.log("AI Response:", result); // Debugging
    res.json({ answer: result.join("") });
  });
});


app.get("/profile", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  
  const user = await User.findById(req.session.userId);
  if (user) {
    res.render("profile", { profile: user });
  } else {
    res.send("User not found");
  }
});

// Route to update profile
app.post("/profile/update", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const { bio, contact, mainImage, backgroundImage, experience, education, projects, skills } = req.body;

  await User.findByIdAndUpdate(req.session.userId, { //req.session.userID
    bio,
    contact,
    mainImage,
    backgroundImage,
    experience: experience.split(","),
    education: education.split(","),
    projects: projects.split(","),
    skills: skills.split(",")
  });

  res.redirect("/profile");
});


const port = 6969;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
