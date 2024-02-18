const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const fs = require('fs');
const User = require("../models/userModel");
const bcrypt = require("bcryptjs");


const privateKey = fs.readFileSync('.private-key')

mongoose.connect("mongodb://10.1.1.109/admin").then(() => console.log("MongoDB connected!"))

const app = express();
app.use(cors())
app.use(express.json())

app.get('/', (req,res) => {
    res.send("Hello world -- Owen Harris");
})

app.post('/register', async (req, res) => {
    try {
        const {email, password, username, firstName, lastName, phoneNum} = req.body;
        if (!(email && password && username && firstName && lastName && phoneNum )) {
            res.json({
                "error": "Required field not found:"
            })
            return;
        }
        const possibleUser = await User.findOne( { email } ) || await User.findOne({ username });
        if (possibleUser) {
            res.json({"error" : "Email/Username already used"})
            return;
        }
        console.log("creating user")
        let newUser = await User.create({
            email, 
            "passwordHash" : await bcrypt.hash(password, 12),
            username,
            firstName,
            lastName,
            phoneNum
        })
        console.log(newUser);
        let id = newUser._id;
        let token = jwt.sign({ id }, privateKey, {expiresIn: "1 day"})
        res.json({ "message": "User created succesfully", token })
    } catch (error) {
        console.error(error);
        res.json({ "error" : "Server error"})
    }

})

app.post('/login', async (req, res) => {
    const {email, password} = req.body;
    const possibleUser = await User.findOne({ email });

    if(!possibleUser) {
        res.json({ "error": "UserName/Email not found"})
        return;
    }
    const authed = await bcrypt.compare(password, possibleUser.passwordHash)
    if (!authed) {
        res.json({ "error": "Password incorrect" })
        return;
    }
    let id = possibleUser._id
    const token = jwt.sign({ id }, privateKey, {expiresIn: "1 day"})
    res.json({ "message": "User authenticated", token })
})

app.post('/verify', async (req, res) => {
    const { token } = req.body;
    jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return res.json({ "status": "error"});
        } else {
            const loggedInUser = await User.findById(data.id);
            if (loggedInUser) return res.send(`Logged in ${loggedInUser.email}, ${loggedInUser.username}`);
            else return res.json({ "status": "error"});
        }
    })
})

app.listen(3000);
