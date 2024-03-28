const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const fs = require('fs');
const User = require("../models/userModel");
const Itinerary = require("../models/itineraryModel")
const bcrypt = require("bcryptjs");
const handlebars = require('handlebars');
const path = require('path');
const config = require('./config');
require('dotenv').config();

const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

const privateKey = fs.readFileSync('.private-key')

mongoose.connect("mongodb://10.1.1.109/admin").then(() => console.log("MongoDB connected!"))

const app = express();
app.use(cors())
app.use(express.json())
app.use(bodyParser.json());

//storing temporary otp data in memory
const users = {};

app.get('/', (req, res) => {
    res.send("Hello world -- Owen Harris");
})

app.post('/register', async (req, res) => {
    try {
        const { email, password, username, firstName, lastName, phoneNum } = req.body;
        if (!(email && password && username && firstName && lastName && phoneNum)) {
            res.json({
                "error": "Required field not found:"
            })
            return;
        }
        const possibleUser = await User.findOne({ email }) || await User.findOne({ username });
        if (possibleUser) {
            res.json({ "error": "Email/Username already used" })
            return;
        }
        console.log("creating user")
        let newUser = await User.create({
            email,
            "passwordHash": await bcrypt.hash(password, 12),
            username,
            firstName,
            lastName,
            phoneNum
        })
        console.log(newUser);
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailId,
                pass: gmailPassword
            }
        });
        const data = {
            firstName: firstName,
            content: `
            We are thrilled to welcome you to the vibrant community of adventurers here at EzTravel!
            <br/>
            <br/>
            Get ready to embark on a journey filled with unforgettable experiences, breathtaking destinations, and lifelong memories waiting to be created.
            <br/>
            <br/>
            Together, let's explore the world, one destination at a time, and make every moment count!
            <br/>
            <br/>`
        }
        const templateStr = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.hbs')).toString()
        const template = handlebars.compile(templateStr, { noEscape: true });
        const html = template(data);
        const mailOptions = {
            from: gmailId,
            to: email,
            subject: `Welcome Aboard! Let's Craft Memories Together!`,
            html: html
        };
        await transporter.sendMail(mailOptions);
        let id = newUser._id;
        let token = jwt.sign({ id }, privateKey, { expiresIn: "1 day" })
        res.json({ "message": "User created succesfully", token })
    } catch (error) {
        console.error(error);
        res.json({ "error": "Server error" })
    }

})

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const possibleUser = await User.findOne({ email });

    if (!possibleUser) {
        res.json({ "error": "UserName/Email not found" })
        return;
    }
    const authed = await bcrypt.compare(password, possibleUser.passwordHash)
    if (!authed) {
        res.json({ "error": "Password incorrect" })
        return;
    }
    let id = possibleUser._id
    let firstName = possibleUser.firstName
    const token = jwt.sign({ id, firstName, email }, privateKey, { expiresIn: "1 day" })
    res.json({ "message": "User authenticated", token })
})

app.post('/verify', async (req, res) => {
    const { token } = req.body;
    jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return res.json({ "status": "error" });
        } else {
            const loggedInUser = await User.findById(data.id);
            if (loggedInUser) return res.json({
                email: loggedInUser.email,
                username: loggedInUser.username
            });
            else return res.json({ "status": "error" });
        }
    })
})

//load gmail credentials
const gmailId = config.email
const gmailPassword = config.password;

console.log(gmailId, gmailPassword)

/**
 * Request OTP for Forgot and reset password: Sends out an otp to registered email id upon validation
 * @param {string} email - Users email ID.
 * @returns {forgotpassword<void>} - Resolves if opt sent successfully, rejects with error otherwise.
 * @author - ysampath
 */
app.post('/api/forgotpassword', async (req, res) => {
    const { email } = req.body;
    try {
        // validate user
        const possibleUser = await User.findOne({ email });
        //if not user,return
        if (!possibleUser) {
            res.json({ "error": "UserName/Email not found" })
            return;
        }
        // Generate OTP 
        const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP

        // Send OTP to email
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailId,
                pass: gmailPassword
            }
        });

        const mailOptions = {
            from: gmailId,
            to: email,
            subject: 'Forgot Password OTP',
            text: `Your OTP for password reset is ${otp}`
        };

        await transporter.sendMail(mailOptions);

        // Save OTP to user object in memory
        users[email] = { otp };

        return res.json({ success: true, message: 'OTP sent to your email' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Server error' });
    }

});

/**
 * Set Forgot and reset password: validate otp and update password on validation.
 * @param {string} email - Users email ID.
 * @param {int} otp - generated otp.
 * @param {string} newPassword - new user password.
 * @returns {resetpassword<void>} - Resolves if password is updated successfully, rejects with error otherwise.
 * @author - ysampath
 */
app.post('/api/resetpassword', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        // Check if OTP matches
        if (!users[email] || users[email].otp !== otp) {
            return res.json({ error: 'Invalid OTP' });
        }
        // Reset Password
        // hashing password
        // const hashedPassword = await bcrypt.hash(newPassword, 12);
        const user = await User.findOne({ email });

        //return error if user not found
        if (!user) {
            throw new Error('User not found');
        }
        // Update the password
        user.passwordHash = await bcrypt.hash(newPassword, 12);

        // Save the updated user object
        await user.save()

        console.log(`Password for ${email} reset successfully to: ${newPassword}`);

        // Remove OTP from memory
        delete users[email];

        return res.json({ success: true, message: 'Password reset successful' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Password reset failed' });
    }
});


/**
 * @author - adpadgal
 */
app.post("/sendotp", async (req, res) => {
    try {
        const { token } = req.body;
        jwt.verify(token, privateKey, async (err, decoded) => {
            console.log(decoded.id)
            if (err) {
                return res.status(401).json({ error: "Unauthorized" });
            } else {
                const otp = Math.floor(100000 + Math.random() * 900000);
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: gmailId,
                        pass: gmailPassword
                    }
                });
                const data = {
                    firstName: decoded.firstName,
                    content: `
                    Greetings from EzTravel, your gateway to extraordinary journeys and unforgettable experiences!
                    <br/>
                    <br/>
                    To ensure the utmost security of your account and safeguard your travel plans, we require a quick verification step.
                    <br/>
                    Please find your one-time password (OTP) below:
                    <br/>
                    <br/>
                    OTP: ${otp}
                    <br/>
                    <br/>
                    Should you have any questions or concerns, our dedicated support team is here to assist you every step of the way.
                    <br/>
                    <br/>
                    Get ready to embark on your next adventure with EzTravel!
                    <br/>
                    <br/>
                    <br/>`
                }
                const templateStr = fs.readFileSync(path.join(__dirname, '..', 'templates', 'email.hbs')).toString()
                const template = handlebars.compile(templateStr, { noEscape: true });
                const html = template(data);
                const mailOptions = {
                    from: gmailId,
                    to: decoded.email,
                    subject: 'Your OTP for Login into EzTravel Account',
                    html: html
                };
                await transporter.sendMail(mailOptions);
                users[decoded.email] = { otp };
                res.status(200).json({ status: "Verification initiated" });
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @author - adpadgal
 */
app.post("/verifyotp", async (req, res) => {
    try {
        const { otpCode, token } = req.body;
        jwt.verify(token, privateKey, async (err, decoded) => {
            if (err) {
                return res.status(401).json({ error: "Unauthorized" });
            } else {
                const json = users[decoded.email]
                if (json.otp == otpCode) {
                    delete users[decoded.email];
                    let id = decoded.id;
                    let token = jwt.sign({ id }, privateKey, { expiresIn: "1 day" })
                    res.status(200).json({ message: "OTP verified", token });
                }
                else {
                    return res.status(401).json({ error: "Invalid OTP entered" });
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


app.post('/api/makeItinerary', async (req, res) => {
    const { title, description, startDate, endDate, token } = req.body; // Get information from request body

    //verify user login

    try {
        let loggedInUser;
        let user = await verifyUserLogIn(token);
        console.log(user);
        if (user.error) {
            return res.status(403).json(user)
        }
        id = user._id;


        console.log("Attempting to create new itinerary for, ", id);

        const itinerary = await Itinerary.create({ title, description, startDate, endDate, "createdBy": id });
        console.log(itinerary)
        return res.json(itinerary)

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

});

app.post('/api/getItineraryList', async (req, res) => {
    const { token } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const Itinerarys = await Itinerary.find({ "createdBy": user._id })
        return res.json(Itinerarys)
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/getItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        console.log(objID);

        const it = await Itinerary.findOne({ "createdBy": user._id, "_id": objID })
        console.log(it)
        if (it) {
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

app.post('/api/deleteItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        console.log(objID);

        const it = await Itinerary.findOneAndDelete({ "createdBy": user._id, "_id": objID })

        if (it) {
            it.deleted = true;
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

app.post('/api/addActivity', async (req, res) => {
    const { token, id, activity, time_start, time_end } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID);

        if (it) {
            const newActivity = {
                activity: activity,
                time_start: time_start,
                time_end: time_end
            }
            it.activities.push(newActivity);
            await it.save()
            return res.json(it);
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

})

app.post('/api/addPlace', async (req, res) => {
    const { token, id, place, time_start, time_end } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);
        const placeID = new mongoose.mongo.ObjectId(place);
        console.log(objID);

        const it = await Itinerary.findById(objID);
        console.log(it)

        if (it) {
            const newDestination = {
                place: placeID,
                time_start: time_start,
                time_end: time_end
            }
            it.destinations.push(newDestination)
            await it.save()
            return res.json(it)
        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

/**
 * Deletes an activity from an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.delete('/api/deleteActivity', async (req, res) => {
    const { token, id, activity } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID)

        if (it) {
            const index = it.activities.findIndex(act => act.activity === activity);
            console.log(index)
            if (index !== -1) {
                it.activities.splice(index, 1);
                await it.save();
                return res.json(it);
            } else {
                return res.status(404).json({ "error": "Item not found in the itinerary" });
            }
        } else {
            return res.status(404).json({ "error": "Itinerary not found" });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }

})

/**
 * Deletes a place from an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.delete('/api/deletePlace', async (req, res) => {
    const { token, id, place } = req.body
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user)
        }
        console.log(place)

        const objID = new mongoose.mongo.ObjectId(id);

        const it = await Itinerary.findById(objID);

        if (it) {
            const index = it.destinations.findIndex(dest => dest.place.equals(place));
            console.log(index)
            if (index !== -1) {
                it.destinations.splice(index, 1)
                await it.save()
                return res.json(it)
            } else {
                return res.status(404).json({ "error": "Item not found in the itinerary" });
            }

        } else {
            return res.status(404).json({ "error": "Itinerary not found" })
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
})

/**
 * Updates the timing of a place in an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/updatePlaceTiming', async (req, res) => {
    const { token, id, place, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const destination = it.destinations.find(dest => dest.place.equals(place));
        if (!destination) {
            return res.status(404).json({ "error": "Destination not found in itinerary" });
        }

        if (time_start !== undefined) {
            destination.time_start = time_start;
        }
        if (time_end !== undefined) {
            destination.time_end = time_end;
        }
        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Updates the timing of an activity in an itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/updateActivityTiming', async (req, res) => {
    const { token, id, activity, time_start, time_end } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const act = it.activities.find(act => act.activity === activity);
        if (!act) {
            return res.status(404).json({ "error": "Activity not found in itinerary" });
        }

        if (time_start !== undefined) {
            act.time_start = time_start;
        }
        if (time_end !== undefined) {
            act.time_end = time_end;
        }
        await it.save();

        return res.json(it);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Shares the itinerary.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The itinerary ID or an error response.
 * @author avmandal
 */
app.post('/api/shareItinerary', async (req, res) => {
    const { token, id } = req.body;
    try {
        let user = await verifyUserLogIn(token);
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }
        return res.status(200).json({ status: "shared", id: it._id })
    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Gets an itinerary with the help of ID.
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The itinerary or an error response.
 * @author avmandal
 */
app.get('/api/getSharedItinerary/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const objID = new mongoose.Types.ObjectId(id);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        await it.save();
        return res.json(it)

    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

/**
 * Adds comment to the itinerary
 * 
 * @param {object} req - The request object.
 * @param {object} res - The response object.
 * @returns {object} The updated itinerary or an error response.
 * @author avmandal
 */
app.post('/api/addComment', async (req, res) => {
    const { itineraryId, token, comment } = req.body;

    try {
        let user = await verifyUserLogIn(token);
        console.log(user)
        if (user.error) {
            return res.status(403).json(user);
        }
        const objID = new mongoose.Types.ObjectId(itineraryId);

        const it = await Itinerary.findById(objID);
        if (!it) {
            return res.status(404).json({ "error": "Itinerary not found" });
        }

        const newComment = {
            body: comment,
            itineraryId: itineraryId,
            username: user.username
        };

        it.comments.push(newComment);
        await it.save();

        return res.json(it);


    } catch (error) {
        console.error(error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});

app.get('/api/convertCurrency', async (req, res) => {
    const base = req.query.base_currency
    const currencies = req.query.currencies;

    console.log("Running convert currency")

    const response = await fetch(`https://api.currencyapi.com/v3/latest?base_currency=${base}&currencies=${currencies}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "apikey": config.API
                }
            });

    const json = await response.json();
    return res.json(json);
});

async function verifyUserLogIn(token) {
    return jwt.verify(token, privateKey, async (err, data) => {
        if (err) {
            return { "error": "Unable to verify login" }
        } else {
            const loggedInUser = await User.findById(data.id);
            if (!loggedInUser) {
                return { "error": "Unable to verify login" }
            } else {
                return loggedInUser;
            }
        }
    })
}




app.listen(process.argv[2] || 3000);
