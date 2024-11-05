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

app.use(bodyParser.json());

//for authentication 
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

app.get('/', isAuthenticated, async (req, res) => {
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
        taskOwner, // Use req.session.loggedInUsername as task owner
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
    const loggedInUsername = req.session.loggedInUsername;
    res.render('postwork', { tasks, loggedInUsername });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).send('Error fetching tasks');
  }
});

// app.get('/postshare', async (req, res) => {
//   const post = await Task.find();
//   const loggedInUsername = req.session.loggedInUsername;
//   res.render('postshare', { post, loggedInUsername });
// })

// Route to render post sharing page
app.get('/postshare', (req, res) => {
  const loggedInUsername = req.session.loggedInUsername;
  if (!loggedInUsername) {
    return res.redirect('/login'); // Redirect to login if the user isn't logged in
  }
  res.render('postshare', { loggedInUsername });
});

// Route to handle post creation form submission
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


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong, please try again later');
});


const port = 6969;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
