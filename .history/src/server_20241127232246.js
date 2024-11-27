const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const mongoose = require('mongoose');
const { Task, User, Message, Post } = require('./mongodb');  
const { check, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const { PythonShell } = require("python-shell");

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
app.use(express.json());

//for authentication fd
function isAuthenticated(req, res, next) {
  if (req.session.loggedInUsername) {
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

app.get('/', async (req, res) => {
  res.render('landing');
});
app.get('/landing', async (req, res) => {
  res.render('landing');
});

app.get('/aboutus', (req, res) => {
    res.render("aboutus");
});

//the page open after logging 
app.get('/index', async (req, res) => {
  try {
    const loggedInUsername = req.session.loggedInUsername;
    const tasks = await Task.find(); // Fetch tasks to display on the index page
    const posts = await Post.find(); // Fetch posts to display on the index page

    res.render('index', { loggedInUsername, tasks, posts });
  } catch (error) {
    console.error('Error loading index page:', error);
    res.status(500).send('Error loading page');
  }
});

app.get("/chatroom", isAuthenticated, async (req, res) => {
  const loggedInUsername = req.session.loggedInUsername;

  if (!loggedInUsername) {
    return res.status(401).send("Unauthorized");
  }

  try {
    // Fetch all tasks where the loggedInUsername is the taskOwner
    const tasks = await Task.find({ taskOwner: loggedInUsername });

    // Fetch messages where the loggedInUsername is the receiver
    const messages = await Message.find({ receiver: loggedInUsername }); 

    res.render("chatroom", { tasks, messages, loggedInUsername });
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
    const loggedInUsername = req.session.loggedInUsername;

    res.render("chat", { taskOwner, loggedInUsername, taskId });
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

    // Save message to MongoDB
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
    const user = await User.findOne({ username, password });

    if (!user) {
      return res.status(401).render('login', { error: 'Invalid username or password' });
    }

    req.session.loggedInUsername = username;
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

    req.session.loggedInUsername = username;
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

app.get('/postwork', isAuthenticated, async (req, res) => {
  try {
    const tasks = await Task.find();
    const loggedInUsername = req.session.loggedInUsername;
    res.render('postwork', { tasks, loggedInUsername });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).send('Error fetching tasks');
  }
});

//route for postwork
app.post('/postwork', upload.array('images', 5), async (req, res) => {
    try {
      const { title, description, deadline, price } = req.body;
      const imageUrls = req.files.map((file) => '/uploads/' + file.filename);
      const taskOwner = req.session.loggedInUsername;
  
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

// Route to render post sharing page
app.get('/postshare', (req, res) => {
  const loggedInUsername = req.session.loggedInUsername;
  if (!loggedInUsername) {
    return res.redirect('/login'); 
  }
  res.render('postshare', { loggedInUsername });
});

app.post('/postshare', upload.single('image'), async (req, res) => {
  try {
    const { caption } = req.body;
    const author = req.session.loggedInUsername;

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

//gemini setup 
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const { GoogleGenerativeAI } = require("@google/generative-ai");

app.get("/askai", (req, res) => {
  res.render("askai");
});

// Route to handle AI chat responses
app.post("/askai", async (req, res) => {
  const question = req.body.question;

  if (!question) {
      return res.status(400).json({ error: "No question provided" });
  }

  try {
      console.log("Input to model.generateContent:", { prompt: question });
      const result = await model.generateContent({ prompt: question });

      if (!result || !result.candidates || !result.candidates[0]?.output) {
          throw new Error("Invalid response from AI model");
      }

      const answer = result.candidates[0].output;

      console.log("User question:", question);
      console.log("AI response:", answer);

      res.json({ answer });
  } catch (error) {
      console.error("Error with AI response:", error.message);
      res.status(500).json({ error: "Failed to generate AI response" });
  }
});

// GET Profile
app.get("/profile", async (req, res) => {
  if (!req.session.loggedInUsername) {
    return res.redirect("/login");
  }

  try {
    const user = await User.findOne({ username: req.session.loggedInUsername }); // Use findOne for username
    if (!user) {
      return res.status(404).send("User not found");
    }
    res.render("profile", { profile: user });
  } catch (err) {
    console.error("Error fetching profile:", err.message, err.stack);
    res.status(500).send("Server error");
  }
});

// GET Update Profile Page
app.get("/profile/update", async (req, res) => {
  if (!req.session.loggedInUsername) {
    return res.redirect("/login");
  }

  try {
    const user = await User.findOne({ username: req.session.loggedInUsername });
    if (!user) {
      return res.status(404).send("User not found");
    }
    res.render("update_profile", { profile: user });
  } catch (err) {
    console.error("Error fetching profile:", err.message);
    res.status(500).send("Server error");
  }
});

// POST Update Profile with Image Upload
app.post(
  "/profile/update",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "backgroundImage", maxCount: 1 },
  ]),
  async (req, res) => {
    if (!req.session.loggedInUsername) {
      return res.redirect("/login");
    }

    try {
      const updates = {
        bio: req.body.bio || "",
        contact: req.body.contact || "",
        experience: req.body.experience ? req.body.experience.split(",") : [],
        education: req.body.education ? req.body.education.split(",") : [],
        projects: req.body.projects ? req.body.projects.split(",") : [],
        skills: req.body.skills ? req.body.skills.split(",") : [],
      };

      // Handle uploaded images if provided
      if (req.files?.mainImage?.[0]) {
        updates.mainImage = `/uploads/${req.files.mainImage[0].filename}`;
      }
      if (req.files?.backgroundImage?.[0]) {
        updates.backgroundImage = `/uploads/${req.files.backgroundImage[0].filename}`;
      }

      // Update user in the database
      const updatedUser = await User.findOneAndUpdate(
        { username: req.session.loggedInUsername },
        updates,
        { new: true } // Return the updated document
      );

      if (!updatedUser) {
        return res.status(404).send("User not found");
      }

      // Redirect to the profile page after successful update
      res.redirect("/profile");
    } catch (err) {
      console.error("Error updating profile:", err.message);
      res.status(500).send("Server error");
    }
  }
);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong, please try again later');
});

const port = 6969;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
