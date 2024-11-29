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
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

//updating multer and storage wala part
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads")); // Save to the 'uploads' directory
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


//gemini setup 
const genAI = new GoogleGenerativeAI("AIzaSyCWCdLylg8SMj9W7CUeiUnp0-mbhMJzRlU");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.get("/askai", (req, res) => {
  res.render("askai");
});

app.post("/askai", async (req, res) => {
  const question = req.body.question;

  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  try {
    console.log("Received question:", question);

    const result = await model.generateContent(question);
    console.log("The result that it generated:", JSON.stringify(result, null, 2));

    const response = result.response;
    if (
      !response ||
      !response.candidates ||
      !response.candidates[0]?.content?.parts[0]?.text
    ) {
      throw new Error("Invalid response from AI model");
    }

    const answer = response.candidates[0].content.parts[0].text.trim();

    res.json({ answer });
  } catch (error) {
    console.error("Error with AI response:", error.message);
    res.status(500).json({ error: "Failed to generate AI response" });
  }
}); 


//the page open after logging 
app.get('/index', async (req, res) => {
  try {
    const loggedInUsername = req.session.loggedInUsername;
    const tasks = await Task.find(); 
    const posts = await Post.find(); 

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
    const tasks = await Task.find({ taskOwner: loggedInUsername });
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

// GET Profile
app.get("/profile", async (req, res) => {
  if (!req.session.loggedInUsername) {
    return res.redirect("/login");
  }

  try {
    const user = await User.findOne({ username: req.session.loggedInUsername }); // Fetch the logged-in user's profile
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
    const user = await User.findOne({ username: req.session.loggedInUsername }); // Fetch the logged-in user's data for the update form
    if (!user) {
      return res.status(404).send("User not found");
    }
    res.render("update_profile", { profile: user });
  } catch (err) {
    console.error("Error fetching profile for update:", err.message);
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
      // Prepare the updates from the form data
      const updates = {
        bio: req.body.bio || "",
        contact: req.body.contact || "",
        experience: req.body.experience ? req.body.experience.split(",").map(item => item.trim()) : [],
        education: req.body.education ? req.body.education.split(",").map(item => item.trim()) : [],
        projects: req.body.projects ? req.body.projects.split(",").map(item => item.trim()) : [],
        skills: req.body.skills ? req.body.skills.split(",").map(item => item.trim()) : [],
      };

      // Add paths for uploaded images, if present
      if (req.files?.mainImage?.[0]) {
        updates.mainImage = `/uploads/${req.files.mainImage[0].filename}`;
      }
      if (req.files?.backgroundImage?.[0]) {
        updates.backgroundImage = `/uploads/${req.files.backgroundImage[0].filename}`;
      }

      // Update the user document in the database
      const updatedUser = await User.findOneAndUpdate(
        { username: req.session.loggedInUsername },
        updates,
        { new: true } // Return the updated document
      );

      if (!updatedUser) {
        return res.status(404).send("User not found");
      }

      res.redirect("/profile"); // Redirect to the profile page after successful update
    } catch (err) {
      console.error("Error updating profile:", err.message);
      res.status(500).send("Server error");
    }
  }
);
module.exports = app;

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong, please try again later');
});

const port = 6969;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${port}`);
});
