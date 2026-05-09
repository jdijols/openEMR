0:00
(Jesse Walberg) Did you see that? Did you Tom did you see that new (Jesse Walberg) uh benchmark that came out with they tried to give uh
0:08
(Jesse Walberg) the LLMs an executable like SQLite FFmpeg (Jesse Walberg) and compilers and they no they couldn't even just with the
0:16
(Jesse Walberg) executable couldn't even start to like develop them none of (Tom Tarpey) H. Yeah. I mean, then there's the converse. A lot of my reverse I do a lot of
0:24
(Tom Tarpey) reverse engineering workwise. Um (Tom Tarpey) and I find that I make
0:32
(Tom Tarpey) tools to reverse engineer. So what you find is if you give good (Tom Tarpey) enough prompt and good enough stuff to an
0:40
(Tom Tarpey) LLM, you can actually get some good reverse engineering going on. (Tom Tarpey) But it doesn't just happen itself. It's it's case a lot of work involved.
0:48
(Tom Tarpey) But it's um it's always fun to see what they what they (Tom Tarpey) actually do. But uh what I'll do is I'll jump on into the start
0:56
(Tom Tarpey) of this and then afterwards we'll do QA Q&A and we'll probably just have like an (Tom Tarpey) AMA and stuff at the end. But
1:04
(Tom Tarpey) yeah, right. So um I suppose intros at the (Tom Tarpey) moment. Uh I'm Tom Tarpy. I'm
1:12
(Tom Tarpey) a AI engineer at Hauntlet. I've was head of engineering for (Tom Tarpey) Bloomtech. Um I've been in the engineering space for just
1:20
(Tom Tarpey) over like three decades. Um during that time most of my (Tom Tarpey) learnings came from my military career. I started off as a
1:28
(Tom Tarpey) sniper uh in the Marines for 10 years (Tom Tarpey) and then a wet work specialist for another 10 years in the SPS. During that time
1:36
(Tom Tarpey) I got several degrees in several different areas including (Tom Tarpey) different strategies and weapon
1:44
(Tom Tarpey) systems and hardware and software development and (Tom Tarpey) things. Um, and kind of that's that's kind of where my
1:52
(Tom Tarpey) skills come from in the first place. Uh, (Tom Tarpey) I I guess I had a slightly different route to a lot of
2:00
(Tom Tarpey) people, but it kind of worked out for me. I (Tom Tarpey) guess I think the key to this is just having skills that you then can transfer to
2:08
(Tom Tarpey) whatever the situation. So, it doesn't matter whether it's hardware, (Tom Tarpey) software, civil engineering, software engine, it's all the same
2:16
(Tom Tarpey) thing. There's no there's no real difference to any of these things. It's just domain (Tom Tarpey) knowledge and subject matter. The same skills
2:24
(Tom Tarpey) apply. So if you can take your skills that you learn here and things that you've (Tom Tarpey) learned over your career and then accumulate them and build them into
2:32
(Tom Tarpey) something that you can use across the board, then it doesn't matter. You'll always be employable. You always (Tom Tarpey) kind of have a place. Uh majority of
2:40
(Tom Tarpey) my actual work involves things like network security, government (Tom Tarpey) contracts and things like that. Um, I still do a
2:48
(Tom Tarpey) lot of different stuff, but most of the time I find myself doing more managerial skills and (Tom Tarpey) managerial stuff these days than actual real
2:56
(Tom Tarpey) work. But yeah, I I enjoy (Tom Tarpey) tinkering. I enjoy ripping things to pieces and rebuilding them and finding how they
3:04
(Tom Tarpey) work and stuff. Whether that's a car or a a (Tom Tarpey) submarine or or a computer or whatever, it doesn't matter. It's same same sort of
3:12
(Tom Tarpey) thing. Uh anyway, enough of the intro stuff. We (Tom Tarpey) can talk about stuff later about stuff like that. I'll share
3:20
(Tom Tarpey) screen. I've got a few slides I can go over. This is more (Tom Tarpey) of a conceptual thing and the things that
3:28
(Tom Tarpey) we would do and process rather than like in there with the codes (Tom Tarpey) and stuff. Codes probably like the least interesting part of this
3:36
(Tom Tarpey) um process. Let's make sure (Tom Tarpey) I'm sharing the right screen. Can everybody see the
3:44
(Tom Tarpey) slides going through taking its time by (Tom Tarpey) look on it? Yeah.
3:52
(Tom Tarpey) Okay. Right. So the subject matter today is we're (Tom Tarpey) thinking about reverse engineering a legacy codebase. This can be applied to whatever codebase.
4:00
(Tom Tarpey) It doesn't have to be legacy. It's just majority of the time I find (Tom Tarpey) myself having to take old stuff and make it
4:08
(Tom Tarpey) new. So, it's a good enough sort of thing to do. We've (Tom Tarpey) chosen like a VB6 one for this because it's
4:16
(Tom Tarpey) it's niche enough to be out there to sort of like (Tom Tarpey) have its own little quirks. So, the idea of today is we're going
4:24
(Tom Tarpey) to be exploring all the concepts of the how we (Tom Tarpey) extract all the building blocks and figure out how the thing works under the hood and
4:32
(Tom Tarpey) and what it has so that we've got the stuff to be able to then move (Tom Tarpey) on to deciding what we want to do. It's not about coding something up. This is
4:40
(Tom Tarpey) about gaining intelligence on an (Tom Tarpey) artifact. So the general objectives today is
4:48
(Tom Tarpey) thinking about reverse engineering sort of like reverse first auditing (Tom Tarpey) which is kind of goes hand inhand with spectrum in
4:56
(Tom Tarpey) development because by the time you finish reversing and auditing the thing you've got all the (Tom Tarpey) specs. So you've got your starting point so you can actually go off and do
5:04
(Tom Tarpey) things and you've got enough intelligence in (Tom Tarpey) the actual application or the the process to be able
5:12
(Tom Tarpey) to actually kind of understand the architecture of it and have (Tom Tarpey) a feel for all of the ins and outs. So it gives you an easier
5:20
(Tom Tarpey) mode for actual software development. (Tom Tarpey) Uh, sorry, we got somebody asking to be let in. Just quickly
5:32
(Tom Tarpey) guests. There we go. So, yes. So, we have (Tom Tarpey) like an easier mode to get access to things. I'm just going to
5:40
(Tom Tarpey) quickly cough. (Tom Tarpey) Sorry. Uh the idea here is once
5:48
(Tom Tarpey) we've kind of got that information, we can (Tom Tarpey) then plan through everything and allow the LLM to
5:56
(Tom Tarpey) do its job. The LM's I know we talk about sort of AI first (Tom Tarpey) development, but it's not always AI first
6:04
(Tom Tarpey) understanding. You've got to understand what you want to do. The AI can't necessarily (Tom Tarpey) tell you that. You have to be the driver. You can't let the AI drive,
6:12
(Tom Tarpey) otherwise you just end up with some hallucinations and awesome crazy (Tom Tarpey) stuff going on. So, the idea is always you be in
6:20
(Tom Tarpey) control. Yes, you can kind of let go a little bit of the (Tom Tarpey) um guardrails and handrails if you like along the way once you've got
6:28
(Tom Tarpey) the system running how you want it and then just nudge it in the right (Tom Tarpey) direction here and there. But at the beginning, you want to be the one in control. You want
6:36
(Tom Tarpey) to kind of state what it is that you want. You want to be opinionated. want to kind (Tom Tarpey) of be the be the actual controller, not let the AI be the controller.
6:44
(Tom Tarpey) You don't want to be the AI's assistant. You want it to be yours. Cuz a (Tom Tarpey) lot of the times you'll find that if you let it control, you're just going to be its assistant committing
6:52
(Tom Tarpey) things or saying yes and not (Tom Tarpey) actually really understand what's going on. So the other
7:00
(Tom Tarpey) thing is we're going to kind of catalog the risk of what's there like (Tom Tarpey) bugs, things like that, and then eventually choose a mitigation strategy or a
7:08
(Tom Tarpey) route to actually get the job done. That could be rewriting it (Tom Tarpey) completely or just fixing bugs or steering it in a certain direction or
7:16
(Tom Tarpey) adding a feature to the current codebase. Doesn't matter what that end goal (Tom Tarpey) is, it's the same process across the
7:24
(Tom Tarpey) board. So the idea of verse (Tom Tarpey) first auditing, think of it like, okay, understand before
7:32
(Tom Tarpey) changing. There's no point in you running in and just closing your eyes, waving your arms back, and (Tom Tarpey) saying, "Hey, yeah, yeah, yeah, fix it." If you don't know what the problem is.
7:40
(Tom Tarpey) I mean, the AI doesn't know what the problem is. You've got to tell it. So, (Tom Tarpey) if you don't understand it, how's the AI going to understand it?
7:48
(Tom Tarpey) Yes, it can kind of infer things, but it can only infer things for things that it's (Tom Tarpey) already been trained on. It's really bad at
7:56
(Tom Tarpey) guessing. It's good at kind of repeating things it's already been told, but (Tom Tarpey) it's not that good at actually guessing still. It seems like it is
8:04
(Tom Tarpey) because it has a lot of data to work with and a lot of compute. And majority of the (Tom Tarpey) times you give it more data and more compute, it can get really amazing things
8:12
(Tom Tarpey) done. But first thing is you need to kind of have a look at what's (Tom Tarpey) there. So you're going to imagine you got like a a blank like a
8:20
(Tom Tarpey) blanket or a sheet and there's a few little bits poking out. You've got to find which (Tom Tarpey) one of those bits you're going to pull on to start off with to unravel the whole
8:28
(Tom Tarpey) thing. So once you find that the (Tom Tarpey) LLM towards it in a way in which it can actually get its job
8:36
(Tom Tarpey) done, but if there's nothing to pull on in the first place, the LM just got this blank slate and it (Tom Tarpey) can just do what it wants. And the problem is it doesn't have any real opinion.
8:44
(Tom Tarpey) it just goes off and randomly does (Tom Tarpey) stuff which is not a good thing when you want an actual you know deterministic thing
8:52
(Tom Tarpey) to happen but once you've kind of done (Tom Tarpey) that you can have a starting point and then that's the
9:00
(Tom Tarpey) seed for the AI to then branch out from and kind of go off and (Tom Tarpey) spider away from and add different things and look up as much as
9:08
(Tom Tarpey) possible so then it can read the source cover to cover capture every single form (Tom Tarpey) every single module every single part of it, every single class, every single
9:16
(Tom Tarpey) function and gain a sort of read, you know, right up (Tom Tarpey) that. If that happens too fast without you understanding the initial
9:24
(Tom Tarpey) things, you just get like you're just going to with like all these files, it's great. That just means you're going to spend (Tom Tarpey) like a week reading files. That's not a lot of
9:32
(Tom Tarpey) use. So that first understanding is the key. (Tom Tarpey) But once you've got that data, then you want it to kind of catalog all the
9:40
(Tom Tarpey) bugs, the the code smell, all the general architectural choices (Tom Tarpey) that have happened and maybe the severity of the bugs, the
9:48
(Tom Tarpey) possible mitigations available. So you want to kind of split it down into its smaller (Tom Tarpey) pieces so you can easily manage it and sort of think about it on a higher
9:56
(Tom Tarpey) level. The job of a software developer these days is actually a software (Tom Tarpey) architect. You've got to kind of have a high level and be able to actually understand all
10:04
(Tom Tarpey) of the moving parts. We're kind of going back to (Tom Tarpey) the late 80s, early 90s of software development where you had
10:12
(Tom Tarpey) to be able to, I don't know, install a server in a place. You had to be able (Tom Tarpey) to do the DevOps CISO ops, the software development, the hardware development,
10:20
(Tom Tarpey) anything and everything that was needed. So, we're turning into the whole polygot (Tom Tarpey) of development. It's completely the opposite
10:28
(Tom Tarpey) to let's say a thing or whatever where you you've got your (Tom Tarpey) specific job you're make you're doing those tickets
10:36
(Tom Tarpey) devops and cisops that's the devops and cisops people stuff as (Tom Tarpey) a software developer nowadays you're back to the good old days where it used to
10:44
(Tom Tarpey) be you just used to do everything that's it so I'm I'm kind (Tom Tarpey) of in my element because this is where I grew up this is it this is the enjoyable time
10:52
(Tom Tarpey) so I'm back in the enjoyable time of everything's awesome (Tom Tarpey) But then once you've cataloged everything, you
11:00
(Tom Tarpey) then get the specifics to rewrite and give (Tom Tarpey) you that design. So you've got a load of different options for your design, but you've also
11:08
(Tom Tarpey) got mitigations for every bug. You've found all the bugs, (Tom Tarpey) you mitigate, you've got the possible mitigations for them with the current codebase.
11:16
(Tom Tarpey) You've also got routes to make new codebase in whatever language or (Tom Tarpey) whatever framework you want. What you don't want to do at the beginning
11:24
(Tom Tarpey) is choose a framework because we always get kind of stuck in (Tom Tarpey) that, hey, yeah, I'm going to write it in this. Ideally, you want to choose the
11:32
(Tom Tarpey) best framework and the best language for the job, (Tom Tarpey) not the one you want to use. Do you know what I mean? Yes, if
11:40
(Tom Tarpey) you're doing all the software development and you're doing all the language stuff and you're actually coding (Tom Tarpey) it, it's good if you know the language. That makes sense.
11:48
(Tom Tarpey) but maybe that's not the right language for that particular thing. So you got to (Tom Tarpey) think about how that can be mitigated and how the trade-offs the good and bad
11:56
(Tom Tarpey) points to each of those things. (Tom Tarpey) So again down to the how it works. So
12:04
(Tom Tarpey) in this case we have some sort of legacy source. Doesn't really matter (Tom Tarpey) what it is. In this case it had like about 13,000 lines of
12:12
(Tom Tarpey) usable code. So it's not a massive code base. It's it's a a moderately sized (Tom Tarpey) one. There's no docs, no tests, nobody maintaining
12:20
(Tom Tarpey) it. So you now just got jumping into this thing, which is (Tom Tarpey) a lot of the times what you'll end up at as a developer. You'll jump in and it's
12:28
(Tom Tarpey) like, okay, what do I do? Oh, look at the docs. There are none. (Tom Tarpey) Okay, well who who's working on it? Oh, he's dead. Okay.
12:36
(Tom Tarpey) Um, how how are we working on the Okay, it's all right. I'll run the (Tom Tarpey) tests. There are none. So this is where you kind of got to pick at
12:44
(Tom Tarpey) threads and figure out what's going on. But once you've got those (Tom Tarpey) threads, you'll you'll do a like an LM driven audit of the thing. Do like
12:52
(Tom Tarpey) a profile analysis. So it kind of gains the (Tom Tarpey) information and kind of like I said, you'll find a little bit to pick at and then
13:00
(Tom Tarpey) spider from that. Finding that first spot is the biggest (Tom Tarpey) hurdle in your entire project. until you can find
13:08
(Tom Tarpey) that entry point in that first spot. It's just an absolute mis, you know, (Tom Tarpey) it's just a mashup of code around the place. So, it
13:16
(Tom Tarpey) helps if you do understand the framework, if it's a language that you've already worked in or you've (Tom Tarpey) used. If it's one that you haven't, I'd say at least get the docs
13:24
(Tom Tarpey) that particular language or that particular framework (Tom Tarpey) because prior to LLM, we'd have docs available to us, whether that's on
13:32
(Tom Tarpey) paper or whether that's on screen and just work through it. It didn't matter (Tom Tarpey) whether you knew the language because you've got the docs. Not
13:40
(Tom Tarpey) necessarily the docs for that project, but the docs for the language at least know, you know, so you don't (Tom Tarpey) always have to memorize everything, but at least have the docs
13:48
(Tom Tarpey) available. And the nice thing is now we can have LMS rag the docs as well, so they've got a (Tom Tarpey) little bit of understanding there as well. And
13:56
(Tom Tarpey) then once we've done the audit, we end up with this bug catalog. In this case, we (Tom Tarpey) had 150 bugs.
14:04
(Tom Tarpey) So quite a bit of messed up stuff in there. So then we've got (Tom Tarpey) them tagged for severity. We've got the mitigations noted as to how we
14:12
(Tom Tarpey) might approach solving those things. Again, all in all in documents, no code at (Tom Tarpey) this point. And the actual code base we actually lock. So it's we
14:20
(Tom Tarpey) go no don't touch that code. This is read only. So you treat it like a (Tom Tarpey) readonly artifact at this point. You're just literally gaining intel. You're gaining
14:28
(Tom Tarpey) information from it. So then you you can get a bunch of (Tom Tarpey) specs from that. The next the next stage down here is the migration.
14:36
(Tom Tarpey) So now we end up with a migration spec whether we've got different forms of routes, what stacks (Tom Tarpey) we could possibly use and we've got a bunch of choices, but we got
14:44
(Tom Tarpey) informed choices with the good and the bad points to those, all the pros, the cons, what the (Tom Tarpey) ramifications and time frames of using those specific
14:52
(Tom Tarpey) routes. And then eventually in this case, we decide on (Tom Tarpey) a a green field rewrite. It's not the fastest
15:00
(Tom Tarpey) to solve, but it's the cleanest and second (Tom Tarpey) fastest thing to do. The first fastest thing to do is
15:08
(Tom Tarpey) incrementally slowly rebuild it from the, you know, (Tom Tarpey) from inside. That sometimes is only choice.
15:16
(Tom Tarpey) Sometimes you're in a codebase where it has to keep running while you're coding it and (Tom Tarpey) binary patching it. You might not even have the source code. So at some points
15:24
(Tom Tarpey) you might just have to make some binaries that kind of fit in and hook into it. So you might have to (Tom Tarpey) make libs or so files depending on the len depending on the
15:32
(Tom Tarpey) operating system and then somehow figure out how to (Tom Tarpey) rename them in a way where it points to your library as
15:40
(Tom Tarpey) opposed to the library that was already written kind of hijacks the (Tom Tarpey) process and then carries on passing on the rest of the information to the stuff that's already
15:48
(Tom Tarpey) there. So that's kind of an extreme thing. But in (Tom Tarpey) legacy systems, sometimes you just don't have the source code. Sometimes you've got to just
15:56
(Tom Tarpey) patch it out and make it work while it's currently being (Tom Tarpey) used. That's like nightmare scenario. But it happens. I it happened to me like
16:04
(Tom Tarpey) last week had to do that. So it's not like it's (Tom Tarpey) a oh 30 years ago or 20 years ago. I'm talking about literally last
16:12
(Tom Tarpey) week. But it is slightly rare in the whole scheme of things. But it's something (Tom Tarpey) you have to kind of think about sometimes. But in this case, a green field
16:20
(Tom Tarpey) rewrite makes sense because it's it's not maintained. It's not used very (Tom Tarpey) often. It's not like us writing a new one's going to hurt the one that's currently in
16:28
(Tom Tarpey) use. So, it just means that we've got to write it as fast as possible, but in a good (Tom Tarpey) way, and then migrate users over to it. So, that way you've
16:36
(Tom Tarpey) still got the system running, but you're migrating them over to the new one without having to worry (Tom Tarpey) about mitigations and stuff.
16:44
(Tom Tarpey) So the anatomy of this like I said this a lot of this kind of rinse and repeat (Tom Tarpey) because it is the same process. So we're doing source reading.
16:52
(Tom Tarpey) So and then making the bud catalog and then mitigating (Tom Tarpey) specs. I'm going to pause here for a moment. Any
17:00
(Tom Tarpey) observations, questions or questions you got for me? I think we got a hand up. (Jesse Walberg) Yeah. What context are we kind of talking about this like
17:08
(Jesse Walberg) switching users over or whatnot? Like are you talking about like migrating to like new (Tom Tarpey) Jesse. Well, in this case, it's on - (Jesse Walberg) like hosting? Are you just talking about like a
17:16
(Tom Tarpey) computer thing. It's not even there's no web, there's no network, there's no nothing. (Tom Tarpey) It's on a computer in a hotel. So, what you'd be doing - (Jesse Walberg) feature? Okay.
17:24
(Tom Tarpey) is let's imagine you got five computers or three (Tom Tarpey) computers and you've got the users are, let's say, clerks at a hotel.
17:32
(Tom Tarpey) So you're migrating those users over to the new system. Maybe (Tom Tarpey) you'll add one computer with the new system and slowly ramp them up while they're still using the
17:40
(Tom Tarpey) old system. But the same process, like you said, it could be a hosted thing where (Tom Tarpey) you're migrating them from the one host into a new hosting or a different
17:48
(Tom Tarpey) process. The actual content is almost irrelevant. It's about the process of (Tom Tarpey) doing that. Do you know what I mean? So it shouldn't really matter whether it was
17:56
(Tom Tarpey) um hosted, whether it's local, whether it's clouded, whether (Tom Tarpey) it's stop gapped or it's all the same sort of
18:04
(Tom Tarpey) concept. Does that make sense, Jesse? Awesome. - (Jesse Walberg) Yeah, thank (Tom Tarpey) I'll stop for a few seconds. Anyone
18:12
(Tom Tarpey) else? (Tom Tarpey) Okay, I'll move on and then we'll probably stop for questions but later
18:24
(Tom Tarpey) that. So now the pipeline here's the kind of slightly more broken (Tom Tarpey) down. We got the manual recon which is you looking at the readme if there's one if there's
18:32
(Tom Tarpey) an executable of some sort maybe trying it running it if it's able to be (Tom Tarpey) done so looking at the general tree of the source going oh I I found
18:40
(Tom Tarpey) some patterns that I've seen in a previous thing or something like that. So you're kind of looking for this thing (Tom Tarpey) to pick at. A big one again is look at the docs for the language
18:48
(Tom Tarpey) or the thing, you know, or the um framework (Tom Tarpey) because usually it'll go this is the entry point or this is the project or this is that so
18:56
(Tom Tarpey) you've got at least an idea of what file you're looking for to start (Tom Tarpey) with and then then you can have the AI sort of scrape the thing. We can
19:04
(Tom Tarpey) use like web lms just throw throw some of the bits at let's (Tom Tarpey) say Grock or Clawai on the web or
19:12
(Tom Tarpey) or somewhere you know it doesn't have to be in your paid thing. It could in this case (Tom Tarpey) it can just be a free one because we don't care about the code. If it's a case of
19:20
(Tom Tarpey) it has to be stopgapped or something then this would be a local LLM that you're using. So it (Tom Tarpey) really depends on obviously the codebase itself. In this case an
19:28
(Tom Tarpey) MIT licensed open sort of thing that's just there. (Tom Tarpey) And then we audit all the forms the UI and the UX. So we get an inference
19:36
(Tom Tarpey) of what is there breaking it down into small (Tom Tarpey) pieces. Then we do a module audit. Now in this case in Visual Basic 6
19:44
(Tom Tarpey) modules are basically your business logic and your data logic. Forms are your (Tom Tarpey) UI the kind of slight separation concerns like
19:52
(Tom Tarpey) MVC. So you you'll do the audit on the modules and then (Tom Tarpey) a data audit like the database any reports anything like
20:00
(Tom Tarpey) that. You make sure 100% that the repo is not (Tom Tarpey) part of the doc. The docs are separated from the repo. So the repo is basically a frozen
20:08
(Tom Tarpey) source that you'll never you're not allowed to touch at this point. The only thing you're allowed to do is read (Tom Tarpey) it. You don't want to be making any code changes at this point because you don't you're just
20:16
(Tom Tarpey) breaking things if you do. Then maybe you have some (Tom Tarpey) localms do a deep dive or whether that's when I say local it could be just clawed
20:24
(Tom Tarpey) clawed code or it doesn't have to be local. I'm talking about just on your (Tom Tarpey) computer do stuff and that then you go off and build your
20:32
(Tom Tarpey) uh catalog of bugs uh like different severity that could be security (Tom Tarpey) issues that could be user issues or any other bits and pieces
20:40
(Tom Tarpey) that are there and possible mig you know mitigations to fix (Tom Tarpey) them. Then we down the pipeline we have okay now we can think about
20:48
(Tom Tarpey) how we're going to migrate and what routes we're going to do. In this case, we evaluated five routes, (Tom Tarpey) chose one, and then possibly any side quest, you know, nice to
20:56
(Tom Tarpey) haves or if you want to add a feature at the end or like here's an (Tom Tarpey) example. Uh, side quest for the open AMR. Let's imagine you've been
21:04
(Tom Tarpey) told to modernize a few things on the Open AMR. One, your side quest would have been add an (Tom Tarpey) LLM. You know what I mean? So, that would have been like a ancillary
21:12
(Tom Tarpey) addition to it as opposed to its main functionality that it started with. So those will be (Tom Tarpey) little things that maybe you add once you've got the system running and doing what you
21:20
(Tom Tarpey) want it to do in the first place like it's its base (Tom Tarpey) functionality. So big
21:28
(Tom Tarpey) takeaway, read before you write. This should be like common (Tom Tarpey) sense, but I'm going to say over 50% of developers I speak
21:36
(Tom Tarpey) to will write software before they actually understand what is (Tom Tarpey) there. They don't, you know, just want because it's like a gut instinct. It's
21:44
(Tom Tarpey) like, okay, I want to get on there and start making stuff. You know what I (Tom Tarpey) mean? The bit that is just take take a step
21:52
(Tom Tarpey) back and don't right, you know, get your documentation right, get your (Tom Tarpey) understanding and Jesse hand up, - (Jesse Walberg) So
22:00
(Jesse Walberg) if like I want to take this current project as an example we have (Jesse Walberg) short amount of time before we needed to like get a first kind of feature
22:08
(Tom Tarpey) mate. - (Jesse Walberg) implemented right like a day or two which a pretty large code (Jesse Walberg) base like how do you like get that kind of
22:16
(Jesse Walberg) understanding in that short amount of time or is to just like get enough to do what you (Tom Tarpey) Mhm. Yeah. So, at the end of the - (Jesse Walberg) need. But that feels uncomfortable, right?
22:24
(Tom Tarpey) day, if you're not uncomfortable, you're not doing your job. (Tom Tarpey) Um, the idea here is we are pushing you in a tight frame.
22:32
(Tom Tarpey) So, it is a bit extreme, but this is more like the extreme (Tom Tarpey) what you may get into. So, we'd rather get you desensitized to that now
22:40
(Tom Tarpey) than you get into there and go, "Ah, I can't do this." (Tom Tarpey) Right? But in general, AI does
22:48
(Tom Tarpey) speed up things. This is why I said before, it's a case (Tom Tarpey) of trying to understand what you can look at
22:56
(Tom Tarpey) what skills you already have and try to apply them to this (Tom Tarpey) situation. Like for instance, this is PHP. Maybe you don't know PHP, but if you know
23:04
(Tom Tarpey) C, C++, JavaScript, TypeScript, the (Tom Tarpey) syntax is similar enough to get away with reading it. You should be able to
23:12
(Tom Tarpey) eyeball and go, that's a that's a for loop, that's a while loop, that's that's an if (Tom Tarpey) condition. So, understanding the actual workings of it bit
23:20
(Tom Tarpey) by bit, it's easy enough. The the trick is getting the high level (Tom Tarpey) overview and changing your paradigm in your
23:28
(Tom Tarpey) mind to uh software architect because realistically (Tom Tarpey) it doesn't matter what the code is once you think of it on an architectural
23:36
(Tom Tarpey) level. You've got a high level view and you're going they're just boxes at this (Tom Tarpey) point that happen to link together in different ways. And any application
23:44
(Tom Tarpey) if you can split it up into like think of it (Tom Tarpey) almost like MVC. So you got your models, you got your views, you got your
23:52
(Tom Tarpey) controllers. In this case, PHP for instance is almost (Tom Tarpey) like it is the API and the front end allin one. So if you
24:00
(Tom Tarpey) are used to things like uh (Tom Tarpey) NextJS, it's that but back in the '9s, it's
24:08
(Tom Tarpey) literally it is the back end, it is the front end, and it's all server (Tom Tarpey) side rendered. So that's all it is. So as long as you
24:16
(Tom Tarpey) can actually take those concepts, the rest of it is just normal (Tom Tarpey) software engineering. So it almost doesn't matter what it
24:24
(Tom Tarpey) is. Um I'm going (Tom Tarpey) to just for time sake uh I'm not I'm going to but uh
24:32
(Yeongbin Lee (Ben)) Yeah, that's perfect. Yeah, - (Tom Tarpey) Ben I was going to (Yeongbin Lee (Ben)) that's perfectly fine. Um, you mentioned earlier, you - (Tom Tarpey) but
24:40
(Yeongbin Lee (Ben)) know, about legacy code bases. Um, at what (Yeongbin Lee (Ben)) point do you say that it's worth keeping a legacy codebase
24:48
(Yeongbin Lee (Ben)) versus like getting it to analyze and rewriting a new one given that, you know, the (Yeongbin Lee (Ben)) old one probably handled a lot of edge cases too, - (Tom Tarpey) Yeah,
24:56
(Yeongbin Lee (Ben)) right? - (Tom Tarpey) it is a case of I'd say 99% of the time in a real (Tom Tarpey) legacy codebase that is let's say enterprise, you're not going to
25:04
(Tom Tarpey) rewrite that. It's going to cost you more time, more (Tom Tarpey) more physical money, more more resources than it's worth. Which is why we've got things
25:12
(Tom Tarpey) running on cobalt. We've got things running on older Java. We got like was (Tom Tarpey) it 1.8 is the normal go-to. What version are we on now? What
25:20
(Tom Tarpey) 21, 22 something. So, because (Tom Tarpey) they work, but if we start touching them and changing things, everything
25:28
(Tom Tarpey) breaks. So, majority of the time it will be patch (Tom Tarpey) it, get it working. Now with AI
25:36
(Tom Tarpey) about we can rapidly increase the velocity in which (Tom Tarpey) we actually build out new systems. So that
25:44
(Tom Tarpey) may change in the future in the sense that okay as AI becomes more (Tom Tarpey) mature and gets better and better at sort like well basically when it gets more data and more
25:52
(Tom Tarpey) compute that's the real uh situation then (Tom Tarpey) it'll be easier to do rewrites things faster in a more
26:00
(Tom Tarpey) meaningful way. So over time I believe it's going to the the paradigm is going to shift into (Tom Tarpey) that sort of situation which may be a good or a bad thing. For instance,
26:08
(Tom Tarpey) cobalt still just works. The reason why cobalt uses it just works. You (Tom Tarpey) replace it with something else, it doesn't work as well. So that
26:16
(Tom Tarpey) kind of says that language is good for that particular purpose and maybe (Tom Tarpey) you don't need to change. Maybe just modernize cobalt
26:24
(Tom Tarpey) itself. So there's there's situations like that. But let's say (Tom Tarpey) net older net applications everybody's screaming for having
26:32
(Tom Tarpey) them change to newer modern version because so much stuff's getting deprecated and and it just doesn't (Tom Tarpey) work and they can't get anything for it. So when they
26:40
(Tom Tarpey) need to add a new feature, they can't. And that brings me back to the whole (Tom Tarpey) binary patching because you can't get the source code or you can't get the bits that you need. You have to kind
26:48
(Tom Tarpey) of stick it together with superglue or or even (Tom Tarpey) Blu-tack. So So there is that. Um,
26:56
(Tom Tarpey) so in reality, a lot of these things are falling apart, but there's (Tom Tarpey) also legacy things that are just working. Here we go. Yeah, David said,
27:04
(Tom Tarpey) uh, net 4 to8 was awful. Absolutely. Well, that's the thing. Nowadays, a (Tom Tarpey) lot of my work is taking an old, like I say,
27:12
(Tom Tarpey) VB6 early.NET and modernizing it to .NET Core (Tom Tarpey) like 10, 9, one of the LTS
27:20
(Tom Tarpey) versions. That can be a headache. But if you get the process correct and (Tom Tarpey) you've done it enough times, it becomes the same as starting a business or something. You
27:28
(Tom Tarpey) you've got to make your playbooks, make your SOPs for it and then (Tom Tarpey) build through and just follow the process and
27:36
(Tom Tarpey) and eventually you learn more and more along the way and it just becomes a repeatable thing that you can (Tom Tarpey) do with whatever the language or whatever the actual framework. And I think over
27:44
(Tom Tarpey) time you'll think, "Oh, I've got a whole day to work on it. Great. I can finish (Tom Tarpey) the entire project." You know what I mean? So there is there is that
27:52
(Tom Tarpey) and it's a case where I think because it's new and it's not necessarily something you do (Tom Tarpey) every single day. It does seem crazy and it does think
28:00
(Tom Tarpey) about the first day you ever did any software development. Imagine you got given a (Tom Tarpey) 10,000 line code base and had to just work on
28:08
(Tom Tarpey) it. No LLMs, no AI. Same sort of concept. It's (Tom Tarpey) it's just getting through it and just doing it. And a lot of the times it's just
28:16
(Tom Tarpey) repetition and and seeing the patterns and the patterns kind of stay the (Tom Tarpey) same across the board. So once you get a few patterns
28:24
(Tom Tarpey) together, you can kind of break down each of them and into their own little boxes and (Tom Tarpey) go this is this is business logic, this is data logic
28:32
(Tom Tarpey) and this is UIUX. Once you've got those three things, (Tom Tarpey) you've got the application. Doesn't matter what the application is, doesn't matter what the
28:40
(Tom Tarpey) framework was. So as long as you can like abstract it in that (Tom Tarpey) sense then you can move forward and build out stuff fairly
28:48
(Tom Tarpey) rapidly. I'm going to move on though. Uh so yeah (Tom Tarpey) so again big takeaway read before writing this should like I said it should be
28:56
(Tom Tarpey) common sense. So now we're finally getting (Tom Tarpey) to the actual patient itself. Star hotel it's a basically single machine
29:04
(Tom Tarpey) single user at a time hotel reservation system. It was literally (Tom Tarpey) originally made for a single specific case, a 52 room property
29:12
(Tom Tarpey) across four floors. It was made for like uh somewhere in (Tom Tarpey) Malaysia originally. Uh it was built in like the modern version
29:20
(Tom Tarpey) of it. It in VB6 was built in 2014 and the (Tom Tarpey) last time anyone touched it was like 2021. That was like it was
29:28
(Tom Tarpey) end of life way before then. The the the technology was probably end of (Tom Tarpey) life like 2000, mid 2000.
29:36
(Tom Tarpey) Um, it's MIT licensed now. So, one of the developers (Tom Tarpey) just went, "Yep, okay, I'm not going to maintain it, but it's
29:44
(Tom Tarpey) here." Um, so it's not maintained. It wasn't really touched since (Tom Tarpey) 2001, 2021. The currency is actually hardcoded
29:52
(Tom Tarpey) to Malaysian ringit. So, you know, I mean, it's it's (Tom Tarpey) literally specific for purpose. Uh, default credentials
30:00
(Tom Tarpey) uh within the codebase. Obviously, they won't have that always, but you'll be surprised how many (Tom Tarpey) actual hotels just have admin admin or admin password still as their password and stuff. It's
30:08
(Tom Tarpey) quite crazy. Um, in this case, it's defaulting to (Tom Tarpey) admin admin. And the thing is, it's printed on the login screen in case they
30:16
(Tom Tarpey) forget. And we're talking production here. This this was normal in like the 90s (Tom Tarpey) and the 2000s.
30:24
(Tom Tarpey) So, the other thing what we got, we got the reporting system which is Crystal Reports. Now it's (Tom Tarpey) 8.5 that had end of life in like 2004,
30:32
(Tom Tarpey) 2005. So it finished then. It wasn't supposed to be used. The (Tom Tarpey) last physical runtime that you can find and download is from like 2025. That was the
30:40
(Tom Tarpey) last time you could actually get it anywhere. So even the archive stuff's going. (Tom Tarpey) So if you've got to actually reproduce it, you're going to have trouble legally
30:48
(Tom Tarpey) getting hold of any of that. And then the other problem (Tom Tarpey) what it's got, it's got like this handrolled goldfishing code thing which is a
30:56
(Tom Tarpey) hash for the password, but it's it's two-way hash. So it can be (Tom Tarpey) reversed. At no point in time should you be able to reverse a hash that is to do
31:04
(Tom Tarpey) with passwords. That that's crazy. It should be a one-way hash (Tom Tarpey) and do what it needs to. That that's kind
31:12
(Tom Tarpey) of you'd think a no-brainer, but somebody thought probably thought it was (Tom Tarpey) cool they make their own hash. I just going to admit
31:20
(Tom Tarpey) someone. So in this case, we've got a few cards with the general idea. We've got (Tom Tarpey) 13ish K lines of behavior lines. There's 16
31:28
(Tom Tarpey) forms, seven modules, 12 database (Tom Tarpey) tables, and there's nine reports, and 150 findings. The findings are pretty much
31:36
(Tom Tarpey) bugs. I'm going to go a little bit (Tom Tarpey) faster through this, but the recon. So, you have your
31:44
(Tom Tarpey) little recon. Figure out what it is that you want to pick at, and then you prompt the (Tom Tarpey) LM to do it at the start. So, again, good versus bad prompt. We think of
31:52
(Tom Tarpey) like the the Goldilocks thing where it's like, you know, is it too hot? Is it too (Tom Tarpey) cold? Is it just right? Same thing with prompts. You've got these like, oh, quick
32:00
(Tom Tarpey) vague thing. I'm going to go a bit overboard, but tell me about the code base. (Tom Tarpey) That's going to get you completely contrived, waffling on about
32:08
(Tom Tarpey) different things about that maybe you don't need to know or don't want to know. Too (Tom Tarpey) eager. Find all the bugs and write it in modern C. That's no good. We've we've
32:16
(Tom Tarpey) mitigated all of the findings now and said, "No, we we we want (Tom Tarpey) to do this thing and we don't care about what's really
32:24
(Tom Tarpey) there." Yeah, no mistakes. Um or just (Tom Tarpey) write in general. Here's a short one but but a little bit on point
32:32
(Tom Tarpey) is start with the specific file that we want to you know the the thread (Tom Tarpey) that we want to pull out in this case star hotel.vbp VBP VBP is
32:40
(Tom Tarpey) the project file and it's basically the manifest of all other things in a (Tom Tarpey) visual basic 6 project. Uh
32:48
(Tom Tarpey) identify the entry point every form referenced every module (Tom Tarpey) referenced every com dependency produce a tree not a critique. So
32:56
(Tom Tarpey) we don't want it to say oh this is great or this is bad. We just want the actual (Tom Tarpey) facts. So that's that's where having the right size and the right
33:04
(Tom Tarpey) concept of the prompt and all the right bits. So what the manual (Tom Tarpey) recon actually told us by looking at it was it's a POS system from small
33:12
(Tom Tarpey) property. It's made for a single person. Uh the (Tom Tarpey) login screen tells you these are things I want you to really
33:20
(Tom Tarpey) you know think about nowadays in modern systems we we wouldn't want (Tom Tarpey) that. So login screen tells you default password. The
33:28
(Tom Tarpey) dashboards are just a color grid of rooms basically. Uh (Tom Tarpey) the publish folder actually has the exe and stuff so you can test it out. And
33:36
(Tom Tarpey) the project file is this file here. So this is our starting point. We found (Tom Tarpey) after all that waffling on all that time, we've got to a point where we've actually got
33:44
(Tom Tarpey) that little thread to pick up. This is it. Now we finally starting at (Tom Tarpey) a thread. So that's going to be now we know enough to tell the
33:52
(Tom Tarpey) LM what to do in in this case something like (Tom Tarpey) that. So the VBP is like a manifest of the
34:00
(Tom Tarpey) entire project. It tells us things like the core functionality (Tom Tarpey) and things like that. So it actually lists every single form and every single basic in the project.
34:08
(Tom Tarpey) So you've actually got a full list of everything and you know (Tom Tarpey) interconnections. So you don't even have to like look at the whole project. All you have to do is look at this one
34:16
(Tom Tarpey) file and you've kind of got the highle overview of it as an architect. (Tom Tarpey) So you don't have to really deep in the weeds of it. It
34:24
(Tom Tarpey) pins all the references to like the data objects, the reporting system, (Tom Tarpey) the com controls and everything else. It
34:32
(Tom Tarpey) also tells you what here's an interesting one. It declares a startup (Tom Tarpey) here sub main. Now that is not a form. Now in a Visual Basic
34:40
(Tom Tarpey) 6 or a VB.NET application, usually the entry point is a (Tom Tarpey) form. It's very visual. Very
34:48
(Tom Tarpey) rare you'll get it actually in things like a a BAS file (Tom Tarpey) or a module of any sort. So this is a strange entry point. This would not be the
34:56
(Tom Tarpey) norm. it it is doable and I can understand why perhaps they thought (Tom Tarpey) it'd be an idea because maybe they thought, "Hey, we need some pre-work that
35:04
(Tom Tarpey) does some stuff, seeds some bits and pieces and does things." You can do all that in your form (Tom Tarpey) anyway, but it looks like they chose randomly to do this. It's
35:12
(Tom Tarpey) it's not so they're not classically trained in Visual (Tom Tarpey) Basic. They're just probably self-taught or they they've kind of picked things
35:20
(Tom Tarpey) up. They went long. Uh also carries the version (Tom Tarpey) of it 1.2.22 22 full full version dark mode. So it kind of gives you a
35:28
(Tom Tarpey) insight into their thought process there. And how we can use (Tom Tarpey) it is read this first before any other source file. It basically allows
35:36
(Tom Tarpey) to inventory every single dependency before you do anything else. So you don't have to touch any (Tom Tarpey) other file at this point. So if you were just given that file, you'd have an overview of the
35:44
(Tom Tarpey) project even if you didn't have any of the source files. So you got (Tom Tarpey) everything you need to get started. So
35:52
(Tom Tarpey) have a look at the unconventional things like the fact it's got a nonform (Tom Tarpey) startup map the code tree zero cost because you've got all of the map here.
36:00
(Tom Tarpey) This this is an excerpt from it like typexe (Tom Tarpey) references objects like the common control and then all of the forms and all of
36:08
(Tom Tarpey) the modules listed. So you've got all of them. So you could throw that (Tom Tarpey) in and say hey go spider and look at this. So you could actually almost say
36:16
(Tom Tarpey) check out the codebase and actually throw this in this context and almost get what you want. (Tom Tarpey) But it's always better to give it specific opinionated what you want
36:24
(Tom Tarpey) it to do though and why it matters. Scope (Tom Tarpey) the audit before writing one line of analysis. So we can actually get the scope of exactly what
36:32
(Tom Tarpey) we do need and what we don't need right from like the first (Tom Tarpey) second of what you know as soon as you hand that off. We can brief the LM
36:40
(Tom Tarpey) without having to rederive every file list all over again. We just pass it this one file and (Tom Tarpey) it's got a index of everything. And we can also catch in the
36:48
(Tom Tarpey) deprecated dependencies like uh where did I see it? All these different (Tom Tarpey) references to the old versions of everything. So you can kind of figure out what's there and
36:56
(Tom Tarpey) what versioning and everything. This is just an excerpt of it. There is a little bit more than this (Tom Tarpey) here, but this is just some relevant interesting
37:04
(Tom Tarpey) parts. So once you've actually (Tom Tarpey) got that little pulling on a thread, you now can audit these things that we
37:12
(Tom Tarpey) found out exist, these forms and these modules. So we've got our map. Now we can go file by for (Tom Tarpey) file every single form. We want a long form analysis. We want to write it
37:20
(Tom Tarpey) using pros. So it's got everything we want with all the bugs, the smells, (Tom Tarpey) any globals, all the names and citations all pulled
37:28
(Tom Tarpey) out. So the way the form audit (Tom Tarpey) works, we want it to go over every single form and we want to capture the purpose and life
37:36
(Tom Tarpey) cycle. So load, events, unload and things like that. We want to understand the (Tom Tarpey) controls and what each one does. the permission checks whether it's got explicit
37:44
(Tom Tarpey) or missing per permissions maybe. So it could be a bug database (Tom Tarpey) touches whether it reads or writes the database in any way. I'm going to say database that could be file
37:52
(Tom Tarpey) reads and writes depending on what the application is and also (Tom Tarpey) globals it reads and writes. So look for look for little things to be able to sort of
38:00
(Tom Tarpey) pull at and understand and then any bugs or dead (Tom Tarpey) codes or half implemented features and stuff that's there or to-dos or fix
38:08
(Tom Tarpey) me. The reason why this actually matters is we end up with one (Tom Tarpey) markdown per form which means we get full cross linking across all the
38:16
(Tom Tarpey) forms very cheaply. Every little finding has full citation back to the (Tom Tarpey) source code and the next person to port it has a chart so they're not guessing
38:24
(Tom Tarpey) everything. They've got all the information they actually need. You imagine if we gave you the (Tom Tarpey) repo with all this in already. Think about how much faster you could ramp
38:32
(Tom Tarpey) up. So this is where you want to get to. This is (Tom Tarpey) this is not the end goal. This is the beginning. So once you've finished doing all this, you're
38:40
(Tom Tarpey) now at the start. So once you've got all this documentation, all this (Tom Tarpey) information, now you can actually start. This in a
38:48
(Tom Tarpey) real world AIdriven development state should be about an hour or (Tom Tarpey) two. So you've done all this took about an hour or two. Now you can
38:56
(Tom Tarpey) start working on the project. At this point, you've got a little bit better understanding of it (Tom Tarpey) hopefully. And that's that's the process of how you can
39:04
(Tom Tarpey) get ramped up a lot quicker. In real world terms, if we use real man (Tom Tarpey) hours for this or person hours or developer hours,
39:12
(Tom Tarpey) this would be a one to two week sprint of just (Tom Tarpey) understanding in prior to AI. This would have been
39:20
(Tom Tarpey) people just pulling out and poking at the code and just actually reading it (Tom Tarpey) all. So it has gained a lot of velocity
39:28
(Tom Tarpey) by utilizing AI. So (Tom Tarpey) in action audit you first it reads the file let's say you open up the form
39:36
(Tom Tarpey) or the basic file then it finds all the smells and everything (Tom Tarpey) it catalogs the findings. So once we've
39:44
(Tom Tarpey) got the catalog we want to like be able to migrate or (Tom Tarpey) whatever it is that we want to do whether that's just a bug fix or whether
39:52
(Tom Tarpey) that's writing it out in a more modern language or framework or whether it's just (Tom Tarpey) patching it or whatever we need to do. But we want that understanding of
40:00
(Tom Tarpey) routes. In this case, we found like five possible (Tom Tarpey) straightforwardish routes and went with the green field
40:08
(Tom Tarpey) one. So in this case, we got a which is the first one which is actually the fastest and (Tom Tarpey) these are real man. These are real work hours. If you didn't have AI, this this be
40:16
(Tom Tarpey) the normal time frames that this would take. Yeah. (Tom Tarpey) So just take a step back and think about how quickly you've actually added
40:24
(Tom Tarpey) these features to a project. the thing (Tom Tarpey) what you've done now would have been three four months work. Just think about
40:32
(Tom Tarpey) that. So if you're feeling stressed over it and the fact that you've done this in like a couple of (Tom Tarpey) weeks, think about how this is 3 six months work you've done in a couple
40:40
(Tom Tarpey) of weeks. So expect to be stressed, expect (Tom Tarpey) to have that sort of thing. So you got to be mindful of that as you go
40:48
(Tom Tarpey) forward. But yeah, so so you got your incremental approach, got VB6 to VB.NET (Tom Tarpey) net using like VBU which is actually a proprietary and
40:56
(Tom Tarpey) um private thing. You'd have to pay licensing for this. It's actually cost you money to (Tom Tarpey) get updated and that's that's about the fastest route
41:04
(Tom Tarpey) but you're only you're only skimming like a month off of real man hours or or work (Tom Tarpey) hours for this. So really the extra license
41:12
(Tom Tarpey) cost for this size of a repo for this amount of it's not worth it. If (Tom Tarpey) it was a larger larger code base imag like a million lines of code. Yes,
41:20
(Tom Tarpey) it would make sense to do complete tooling and and not do as much (Tom Tarpey) hands-on, you know what I mean? But the fact that this is a fair relatively small code
41:28
(Tom Tarpey) base, you doesn't make so much sense to pay loads of money out (Tom Tarpey) and that would actually slow down development really in the current AI
41:36
(Tom Tarpey) scope because we've got AI. You could swap that out for AI. So that maybe make (Tom Tarpey) it a bit more meaningful. Then you got a green field remaking
41:44
(Tom Tarpey) it like .NET 10, C using like Avalonia and (Tom Tarpey) SQLite. So more modern. So we've got no deprecation. We we got kind of
41:52
(Tom Tarpey) future proof for the next XYZ years as opposed to trying to patch (Tom Tarpey) on top of patch on top of patch. Then there's the options of
42:00
(Tom Tarpey) languages. Let's mainly go Python. You could use Python and Py (Tom Tarpey) side. Um you could use Java like Java FX. You could use like
42:08
(Tom Tarpey) TypeScript with let's say TA 2 for your Rust (Tom Tarpey) Rustation um or whatever web application. So you've also got your
42:16
(Tom Tarpey) time frame. So in this case developer hours of 4 to (Tom Tarpey) 8 months, 5 to 9 months, 6 to 10 months, 7 to 11 months
42:24
(Tom Tarpey) or or 6 to 10 months. So you got your kind of optionals there. And again, you've (Tom Tarpey) always got that good point, bad point drawbacks here. If you make it in Python, maybe
42:32
(Tom Tarpey) they're used to the UI. Anything written in .NET's going to have a specific kind of (Tom Tarpey) flavor to it and a feel to it. It's going to be a bit more integrated because it's Microsoft. So if
42:40
(Tom Tarpey) it's on Windows, it's going to feel the same. As soon as you jump onto Python, it will look (Tom Tarpey) completely different. the the the UI is going to feel different. So that's sometimes
42:48
(Tom Tarpey) a bad point for user experience. Same with Java. TypeScript is its own thing (Tom Tarpey) because you could technically make it look exactly the same as that if you wanted
42:56
(Tom Tarpey) to. So you you might have a little bit of leeway there. But in (Tom Tarpey) this case, in a real world setting, if this was a real company setting
43:04
(Tom Tarpey) for this, you would probably go the green field route because of AI (Tom Tarpey) existing because these months turn into probably hours or
43:12
(Tom Tarpey) weeks. uh to do this. I've literally done this (Tom Tarpey) before so many times on so many different uh
43:20
(Tom Tarpey) migrations. It with a good setup and and a good tooling and a good (Tom Tarpey) harness and a bunch of scripts that you've done before and a bunch of boiler plate
43:28
(Tom Tarpey) and templates, you can get this done in a matter of (Tom Tarpey) hours. So this this this 5 to9 months actually ends up being like 2 to
43:36
(Tom Tarpey) three hours. We're not expecting you to do that, but that (Tom Tarpey) that's what you can with the right tooling, the right knowledge, and the right
43:44
(Tom Tarpey) background. So, it makes sense to do a couple of hours (Tom Tarpey) green field as opposed to this would probably still take a couple of
43:52
(Tom Tarpey) weeks. You know what I mean? Even with all the AI and (Tom Tarpey) stuff. So, in that sense, the green field makes far more
44:00
(Tom Tarpey) sense. But if you've got a a kickback or (Tom Tarpey) or a push back from the product owner or whatever, no, no, we have to
44:08
(Tom Tarpey) keep it in VB6. Then you got to think about other mitigations like just okay, (Tom Tarpey) let's just fix the bugs. Let's let's try to do, you know, and you
44:16
(Tom Tarpey) got to work within the confines of what the spec is and what actually is asked of you because it's (Tom Tarpey) it's not just a case of we're just randomly making things.
44:24
(Tom Tarpey) Uh so realistically the Python, Java and Typescript kind of go out the window for (Tom Tarpey) this as far as the UI concerned and the quickest
44:32
(Tom Tarpey) route is just making a green field. Now the G green field for your purpose could (Tom Tarpey) be a Python or Java Java or TypeScript or whatever. It doesn't really
44:40
(Tom Tarpey) matter. It's just in this case we chose green field of similar sort (Tom Tarpey) of workflow and usually the developers who would have developed
44:48
(Tom Tarpey) anything looking at this will probably have some C# knowledge and modern (Tom Tarpey) stuff. So, it will be like their go-to to work
44:56
(Tom Tarpey) on. Right, I've kind of uh wafted on a (Tom Tarpey) bit. So, the big takeaway, take away the process. Don't don't worry about the actual
45:04
(Tom Tarpey) codebase. The code is almost irrelevant. It's not completely irrelevant, (Tom Tarpey) but once you get the process down and can abstract away all of the
45:12
(Tom Tarpey) bits, the minutiae of the actual language itself becomes (Tom Tarpey) just documentation. And as long as you understand the
45:20
(Tom Tarpey) process and the reasoning for why one thing happens versus (Tom Tarpey) another thing happening, the actual intricacies of like I did
45:28
(Tom Tarpey) five while loops with this and blah blah blah is irrelevant. It's more (Tom Tarpey) a case of I did this because of this and this is the business outcome
45:36
(Tom Tarpey) what I get from doing this specific task. So (Tom Tarpey) it's more about turn them into this flow as opposed to actual code. Think
45:44
(Tom Tarpey) about more like a process diagram. So you don't have to worry so much about (Tom Tarpey) the code. It's just nice to understand the code for when things break.
45:52
(Tom Tarpey) Like if if the AI goes around in circles doing the same problem over and (Tom Tarpey) over again. If you know the code, you might go, "Hang on, there's one literal. Okay,
46:00
(Tom Tarpey) let look change this one line here cuz you happen to know that code." (Tom Tarpey) So I found that a few times where it all just round and round in circles and you'll go,
46:08
(Tom Tarpey) "No, it's not working. Blah, blah, blah. Do this." And it will go off and say, "Yeah, yeah, I've done that." (Tom Tarpey) And it hasn't. It's done some other stuff. So those are the times where it's nice to be
46:16
(Tom Tarpey) able to just jump in and maybe change one little line of code that saves you a week of (Tom Tarpey) headaches. So sometimes it's good to well I'd
46:24
(Tom Tarpey) say most of the time at least have a ancillary understanding of the (Tom Tarpey) language but once you know one language other languages
46:32
(Tom Tarpey) of the same paradigm are fairly easy to ramp up on. So if you (Tom Tarpey) know an object-orientated language, you should be able to ramp up on another
46:40
(Tom Tarpey) object-oriented language quite quickly. In in (Tom Tarpey) industry, we tend to do it in like a day, maybe two days. So you go from one
46:48
(Tom Tarpey) language, knowing enough of the next language, be able to actually ramp up and just start building in (Tom Tarpey) it. So the the hard part is just getting used to being able to look at
46:56
(Tom Tarpey) docs, see the patterns of one language, and really you're not learning (Tom Tarpey) a language, you're learning a paradigm. So you know like functional paradigm,
47:04
(Tom Tarpey) procedural paradigm or object-oriented (Tom Tarpey) paradigm. So once you know enough about let's say one or two object-orientated
47:12
(Tom Tarpey) languages, you can usually pick up the next one in like a day. Once you know enough (Tom Tarpey) functional paradigm languages, same sort of thing or procedural, same
47:20
(Tom Tarpey) sort of thing. So it's understanding the paradigms more than actually (Tom Tarpey) understanding the things. It's all just syntax and bits and pieces
47:28
(Tom Tarpey) there. How we doing on time? We're getting quite close. But yeah, (Tom Tarpey) so this was kind of closing out. What I would say is uh have a mess with the reference
47:36
(Tom Tarpey) repo. There's no code changes. It's all documentation. (Tom Tarpey) I'd say look at look at don't try and understand the whole thing.
47:44
(Tom Tarpey) Pick a little piece of it like one form. Look at the analysis. (Tom Tarpey) Maybe one one bit of the bug catalog one bug and look at it. See
47:52
(Tom Tarpey) what's happening. Have a look at the migration spec of one thing. Don't don't (Tom Tarpey) like overdo it and pull it. I did kind of pull up
48:00
(Tom Tarpey) one dialogue form here. So, here's all the forms. So, you got (Tom Tarpey) all the forms, you've got all all the um
48:08
(Tom Tarpey) modules, you got the whole project specs and all the different manifest and all (Tom Tarpey) the bits and pieces about it all sort of organized into their
48:16
(Tom Tarpey) place. Overall, what we've done though is we've done a read me. So, we've got kind (Tom Tarpey) of this is your source of truth. So, you've got a high level overview of
48:24
(Tom Tarpey) everything. And then that kind of (Tom Tarpey) links into whichever bits that you'd want to look into. I'm going to just randomly choose where
48:32
(Tom Tarpey) are we? Let's go the report form. Doesn't really matter which form (Tom Tarpey) because I just want to show you the layout. So you've got the name of
48:40
(Tom Tarpey) it. You've got a general sort of excerpt of here's what it (Tom Tarpey) does. Then you've got the layout. So we've got the whole layout. You can literally almost pass this
48:48
(Tom Tarpey) to an LLM and say, "Hey, make this form in HTML. Make this (Tom Tarpey) form in Java. Make it in swing." So you actually have
48:56
(Tom Tarpey) the building blocks to do stuff. You could build your you could pass all this (Tom Tarpey) to the thing and say make me a P to make this in Java, make me a
49:04
(Tom Tarpey) P to make this in TypeScript. So there's (Tom Tarpey) enough information there. It's all broken down into like layout, general
49:12
(Tom Tarpey) module state, any logic that's inside (Tom Tarpey) there, and also little notable points and little quirks about it. So if there's any like
49:20
(Tom Tarpey) weird things that are outside the norm, that's the same process for all of them. (Tom Tarpey) If I go like I don't know print form same sort of thing
49:28
(Tom Tarpey) layout so that the the actual things in a very (Tom Tarpey) simplistic way where a person or an LM can really just ramp up on it and
49:36
(Tom Tarpey) understand each of the pieces and that's where you want to go (Tom Tarpey) to. Think of it you want it in a way where it's easy enough for you to
49:44
(Tom Tarpey) understand and for an LLM to pass because it's no good you (Tom Tarpey) not understanding a single thing of it and then just waving your hands and hoping it
49:52
(Tom Tarpey) works. But also, you don't need to know every little detail about (Tom Tarpey) it. You need a high level overview. Think you're the architect. You're no longer
50:00
(Tom Tarpey) the software developer typing all the code. You're the (Tom Tarpey) architect telling your workers to do their thing. Think
50:08
(Tom Tarpey) of think of the LMS as a bunch of coding interns. They're (Tom Tarpey) your team. You're now the the manager. You're the architect of
50:16
(Tom Tarpey) the thing. So you need the high level overview, the understanding of it, and the ability (Tom Tarpey) to just jump in if you need to to assist them, but
50:24
(Tom Tarpey) you want to make sure you're the opinionated. Again, I'm going to This is one thing that I'll (Tom Tarpey) say every single day. You're the opinionated one and make sure you're the
50:32
(Tom Tarpey) one in control. (Tom Tarpey) Okay, we got a hand up. Oh, is that waving or that's hand up? Uh,
50:40
(Scott Bushyhead) Hey Tom, I thought this was really (Scott Bushyhead) uh interesting. Curious. I come from a a large e-commerce background
50:48
(Scott Bushyhead) where my application is going to touch a number of other applications and (Scott Bushyhead) I probably have multiple teams that are dependent on the contracts that are coming out of that
50:56
(Tom Tarpey) Scott. - (Scott Bushyhead) application. When we're doing these things and we're mitigating the bugs and (Scott Bushyhead) you know altering the the Dows of how the application has worked for the
51:04
(Scott Bushyhead) last teen years, it feels like we've limited the scope too (Scott Bushyhead) much already because our our documentation is
51:12
(Scott Bushyhead) not recognizing what those other pieces are expecting or (Scott Bushyhead) what we're getting from those. Is is this not the pattern you would use in an
51:20
(Tom Tarpey) Sorry. Right. Yeah, there's there's a few - (Scott Bushyhead) environment like that? Does it have to (Tom Tarpey) caveats here. This is for this specific thing. If it was a larger scale or - (Scott Bushyhead) be
51:28
(Tom Tarpey) something, you also need to pull in contracts, but contracts would just be part of the (Tom Tarpey) thing. So, you'd expect that to already be there. It's just this one
51:36
(Tom Tarpey) doesn't because it's completely inhouse. It doesn't need a network. It doesn't need anything. It (Tom Tarpey) just has that physical thing. But no, definitely you you - (Scott Bushyhead) Sure.
51:44
(Tom Tarpey) you'd rely a lot on contracts. I mean when we say contracts in this the schema and the (Tom Tarpey) database of the contract. So it does rely on that but just in its - (Scott Bushyhead) Right. Okay.
51:52
(Tom Tarpey) own scope. But absolutely I mean I've worked on systems and the problem (Tom Tarpey) is you can only rely on contracts to a certain
52:00
(Tom Tarpey) extent because especially a lot of larger organizations (Tom Tarpey) especially the contracts will be there and some of the developers will adhere to
52:08
(Tom Tarpey) them but some won't and what happens is you have this disparity (Tom Tarpey) sometimes. So you can't a lot of your work is figuring out which are the correct
52:16
(Tom Tarpey) contracts. So that that's always a headache. I've seen that in a few - (Scott Bushyhead) Right. (Tom Tarpey) different companies and and it's it's across the board, especially with large as you spread out
52:24
(Tom Tarpey) your team to a larger and larger sort of like area and (Tom Tarpey) landscape. You've got all these different ways of doing things and they rarely
52:32
(Tom Tarpey) follow the spec or follow the actual, you know, contracts in the first (Tom Tarpey) place. So sometimes the contracts have to go out the window as well,
52:40
(Tom Tarpey) but it sometimes as well, like you say, a bug could be actually (Tom Tarpey) a feature that they rely on. So you also have to make sure that you
52:48
(Tom Tarpey) understand the landscape of all of it at that point. So it's not you're not just (Tom Tarpey) looking at this one code base then you need to understand what its - (Scott Bushyhead) Gotcha.
52:56
(Tom Tarpey) contracts are and what actually it is. So you might have all your bugs and it might (Tom Tarpey) be for instance I'm porting Doom at the moment to my operating
53:04
(Tom Tarpey) system. There's a bug that kept coming up and it gone round circle. It's not a bug. It's just a (Tom Tarpey) feature of Doom. So that caused a problem because I let the AI have
53:12
(Tom Tarpey) a little go. I was like hang on why are you doing that? And it's like, oh, and it went round in (Tom Tarpey) circles trying to fix this bug. And it's like, it's not a it's needed. It can't work
53:20
(Tom Tarpey) without. So, I had to put some mitigation stuff in there, a note to it to go, no, (Tom Tarpey) do not touch that. It's a requirement. So, same sort of thing with
53:28
(Tom Tarpey) anything. It's it's a case of the contracts do have to stay (Tom Tarpey) firm. But you also, like you said, you pointed out with the whole bug thing. In
53:36
(Tom Tarpey) this case, any of the bugs are actual, but things like you click on the (Tom Tarpey) logo and it accidentally leaks the admin username password and autofills
53:44
(Tom Tarpey) the thing. That probably was a dev feature, but one (Tom Tarpey) of the developers like, "Oh, please test the thing." And they forgot to take it - (Scott Bushyhead) Yeah,
53:52
(Tom Tarpey) out and now it becomes possibly a feature for the (Tom Tarpey) clerk who can't remember the password. So, you - (Scott Bushyhead) right.
54:00
(Tom Tarpey) do have to be mindful of the actual users as well during that time. And (Tom Tarpey) it looks like we got a few more hands up, right? Uh Victor, I think you're
54:08
(Victor Rojas) Yeah, appreciate it. Tom, uh I'm curious at (Victor Rojas) what point do you try to understand the sort of business domain
54:16
(Victor Rojas) case and uh is that from the onset or after (Victor Rojas) you do the recon? And then similarly is like the - (Tom Tarpey) next.
54:24
(Victor Rojas) risk catalog the point where you start adding specs and not anytime (Tom Tarpey) Well, yeah. So, let's let's break this down. So, so
54:32
(Tom Tarpey) the business case is one of the artifacts. (Tom Tarpey) So, first you're getting your thread to pull. I haven't
54:40
(Tom Tarpey) anything. As soon as you got that thread, you're breaking it down into business (Tom Tarpey) logic, database, data logic, and
54:48
(Tom Tarpey) UI. So, business case is usually within the business logic. If (Tom Tarpey) you got lucky and it's got good documentation, you'll gain a lot of insight there as
54:56
(Tom Tarpey) well. Or if you got even luckier and you're able to talk to the (Tom Tarpey) developer, then you get even better, you know, because they'll know little quirks about the thing that's
55:04
(Tom Tarpey) not even documented. Oh, you know, when you do this, you got to kind of waggle it to one side and (Tom Tarpey) then and then hit the screen a bit and then all a sudden the code
55:12
(Tom Tarpey) works. So, so it's really down to that. But yeah, so there's that. And I've kind (Tom Tarpey) of lost my train of thought. So there was that. And what was the other
55:20
(Victor Rojas) uh regarding the spec like to do once - (Tom Tarpey) question part? (Victor Rojas) catalog is is established or uh is like having them - (Tom Tarpey) Yeah, usually your docs come first.
55:28
(Victor Rojas) exploratory. Okay. - (Tom Tarpey) Your doc Yeah, your docs always come first. Now, obviously it depends on whether (Tom Tarpey) you're doing a vertical or a horizontal split on your
55:36
(Tom Tarpey) stuff. If you're doing like a horizontal split, then you can probably (Tom Tarpey) just work on the whole thing, you know, document the whole of that thing. If you're
55:44
(Tom Tarpey) doing um like vertical splits, you can do slice by (Tom Tarpey) slice. So, you can just document that, hand that off. your
55:52
(Tom Tarpey) LLM can work on that while you're documenting the next thing. As long as you can (Tom Tarpey) document fast enough for it to think, you can make a nice pipeline there. That's what one of
56:00
(Tom Tarpey) the reasons why I got so many computers. I'll have four or five computers working on one (Tom Tarpey) project and most of my time I'm not sitting down. I'm typing a
56:08
(Tom Tarpey) thing, doing some stuff, setting it all up. One's doing some (Tom Tarpey) um resource management and looking at the thing and recon another thing is doing
56:16
(Tom Tarpey) something else on there. Another and I'm just like jumping between things and usually I have shared (Tom Tarpey) resource. So you'll have orchestration. You're putting
56:24
(Tom Tarpey) the stuff in there. You're the let's say this computer is the only one that's allowed (Tom Tarpey) to write to it and the other ones can read from it. So now we've got a bunch of
56:32
(Tom Tarpey) developers. So I've got the entire development team. But instead of just having it as little threads on my one (Tom Tarpey) computer, I've got the whole process, the whole one
56:40
(Tom Tarpey) computer being the resources for that, one computer being the resource for that (Victor Rojas) like bounding - (Tom Tarpey) one computer. So it's just scaling it up. All
56:48
(Victor Rojas) the context and then allowing that to agree. - (Tom Tarpey) right. Yeah. any information are you just walking through the room (Tom Tarpey) going walking through the room next one go off have a walk
56:56
(Tom Tarpey) off get a cup of coffee come back and rinse and (Tom Tarpey) by the time you finished with that you're on your next lot of three computers on the next project
57:04
(Tom Tarpey) next project and by the time you come back here it's finished what it needs to do (Tom Tarpey) so you're not sitting there waiting so you don't even have to have a
57:12
(Tom Tarpey) souped-up mad computer this one's got like 16 gig of RAM on (Tom Tarpey) it it's an old but this was one the floor randomly.
57:20
(Tom Tarpey) I put up here there's one with 48 gig over there, there's 64 gig over there. (Tom Tarpey) There's 256 gig and 2 uh 27
57:28
(Tom Tarpey) terabytes of space on the one that's usually used for data, you know, for (Tom Tarpey) triaging things or experiments. Uh also
57:36
(Tom Tarpey) got about load of uh GPUs in it as well for inference and (Tom Tarpey) stuff. Um and then we got smaller ones for different things and and
57:44
(Tom Tarpey) a lot of them are like 16 gig, 32 gig. There's some 8 gig ones (Tom Tarpey) out there but are very rarely you they're more for like just documenting and stuff and
57:52
(Tom Tarpey) you just split it split it across the lot and then really all of those use one (Tom Tarpey) computer because they're all doing their little thing. They're all each agent has its own
58:00
(Victor Rojas) Make it really really insightful. - (Tom Tarpey) computer then I got lucky. (Tom Tarpey) I don't pay any electric. It's all in with the
58:08
(Tom Tarpey) rent. It's a bit different. I mean to be fair they're fair enough low enough power (Tom Tarpey) to not just pay for the electric separate if I need to. But it's nice
58:16
(Tom Tarpey) not to have to. Um, especially with the server. (Tom Tarpey) That's probably the biggest killer of the, you know, massive, the server's getting
58:24
(Tom Tarpey) old now. It's a, it's an Optron. No, not not an Optron. Uh, it's (Tom Tarpey) a Xeon. So, I got, I think, eight
58:32
(Tom Tarpey) cores, but there's eight CPUs, so it's (Tom Tarpey) like So, it's fairly beefy high. That's it. At the time, it was
58:40
(Tom Tarpey) very expensive. Nowadays, you probably pick up the actual base for probably about (Tom Tarpey) $600 or something. you know, uh, but the graphics cards, every time
58:48
(Tom Tarpey) I got a spare 20 grand, I'd buy a new graphics card. I just kept doing (Tom Tarpey) that. I've done that over years. So, some of the little dated, but each time
58:56
(Tom Tarpey) I'm just going add more, add more compute, and it'll (Tom Tarpey) take it's still got room for loads more graphics cards still. So,
59:04
(Victor Rojas) It's like you apply it to the hardware sense as well. The same - (Tom Tarpey) it's nice little toy. Um, (Victor Rojas) process. Yeah, that makes sense. - (Tom Tarpey) yeah, but literally that that's kind of that.
59:12
(Tom Tarpey) Uh, sorry, we got another right. I think (Alexander Chan) Hi. Yeah, thank you for the um thank you for the
59:20
(Alexander Chan) talk was very educational. Um, and I really like that (Alexander Chan) how you thought like the human is driver's seat, but I'm just curious like
59:28
(Alexander Chan) um what if you're not what what if you don't know what you're doing like (Alexander Chan) not you don't know what you're doing like say like I I've never worked on encryption before or
59:36
(Alexander Chan) authentication but like you know if I'm the guy that needs to do it my manager - (Tom Tarpey) Alexander (Alexander Chan) said you know or like maybe I'm running my my my solo business or something
59:44
(Alexander Chan) whatever if I need to do it and I need to do it quickly how would you do it (Alexander Chan) with the help of LLMs? - (Tom Tarpey) There's always a tradeoff like you know speed and
59:52
(Tom Tarpey) accuracy. So it depends how quickly and how accurate you (Tom Tarpey) want to be. You're never going to get the perfect thing. So there's always
1:00:00
(Tom Tarpey) going to be mitigations and trade-offs. Um, it's then down to (Tom Tarpey) trying to re, it's down to your research on what would be the best model and the
1:00:08
(Alexander Chan) Right. - (Tom Tarpey) best data to use in that situation. That's what you need (Alexander Chan) Good. - (Tom Tarpey) to get good at is understanding what tools you've got at
1:00:16
(Tom Tarpey) your hands and what you can leverage cuz you don't want to get (Tom Tarpey) like let's say let's say you get like I don't know Llama 2 and try
1:00:24
(Tom Tarpey) and make that do all your stuff. It's not you know it kind (Tom Tarpey) of won't do the job. But if you get a specifically trained
1:00:32
(Tom Tarpey) thing specific on cryptography or stuff like that, you can probably use it (Tom Tarpey) a little bit like a tutor. But don't believe every single word it says.
1:00:40
(Tom Tarpey) That's all I'd say. So you you've just got to use a little bit of common sense and (Alexander Chan) Yeah, I I I guess maybe more specifically - (Tom Tarpey) other things in it as
1:00:48
(Alexander Chan) like what would your workflow be to like (Alexander Chan) say say you got this bug, you know, is it's an authentication bug. or like you know - (Tom Tarpey) well.
1:00:56
(Alexander Chan) it's you know an authentication but you have no experience with it whatsoever (Alexander Chan) whatsoever like what would your workflow be like other than like know learning
1:01:04
(Alexander Chan) it what would you what would be your workflow to make sure you're on that (Alexander Chan) like efficient frontier curve of of uh accuracy and speed
1:01:12
(Alexander Chan) like like maybe you you want to be on that curve but you don't you you don't want to be (Alexander Chan) sub-optimal - (Tom Tarpey) Mhm. There's never going to be a perfect
1:01:20
(Tom Tarpey) optimization there, but I would say a lot of this is going to be down (Tom Tarpey) to being good at prompting, uh, getting the
1:01:28
(Tom Tarpey) right actual model and literally ragging on the docs (Tom Tarpey) for that specific thing. So you want the
1:01:36
(Tom Tarpey) documentation and this is going to be a case of throwing money at it. If you want (Tom Tarpey) speed and accuracy, you throw money at it. So think of it as
1:01:44
(Tom Tarpey) trifecta. You got money, speed, (Tom Tarpey) correctness. Pick two. You don't get all of
1:01:52
(Tom Tarpey) them. So usually throw more money at it, throw more compute at (Tom Tarpey) it. And then it's down to your speed of learning because you still got to learn. Doesn't
1:02:00
(Tom Tarpey) matter what happens. You still got you never stop learning. So (Tom Tarpey) my normal process, the problem is it's hard to say because
1:02:08
(Alexander Chan) Gotcha. - (Tom Tarpey) let's let's imagine that AI existed in ' 80s like (Tom Tarpey) it does right now. That's the time when I'd have to learn
1:02:16
(Tom Tarpey) things. Um if that was the case and I didn't know (Tom Tarpey) it, I would say my normal process would be
1:02:24
(Tom Tarpey) literally researching what the best tool is for the job, (Tom Tarpey) grabbing as much documentation for it as possible. And since we got AI, we can
1:02:32
(Tom Tarpey) throw lots. They can read really fast. So it's your it's your intern. Have (Tom Tarpey) it read it and summarize all the possible problems. So
1:02:40
(Tom Tarpey) you're not relying on it to have its knowledge, but you're giving it the data it (Tom Tarpey) needs. It's going to be good at sifting through data.
1:02:48
(Alexander Chan) H. That's - (Tom Tarpey) Sorry, just going to (Tom Tarpey) cough. So it's going to be really good at sifting through data. So use it as the tool it's
1:02:56
(Tom Tarpey) good for. So what you're going to do is you're going to find all the ducks (Alexander Chan) it. - (Tom Tarpey) that are to do with that language, that framework, that specific
1:03:04
(Tom Tarpey) thing. Maybe give it access to search the (Tom Tarpey) web and then give it the specific error or problem that you've got.
1:03:12
(Tom Tarpey) Describe it in the best way you can and ask it to describe it back to (Tom Tarpey) you and and think of it like the rubber duck
1:03:20
(Tom Tarpey) situation. So you're talking to this inanimate (Tom Tarpey) object, but now you're talking to the AI. So the same process you would go
1:03:28
(Tom Tarpey) through using rubber rubber duck technique, you you'll talk over it (Tom Tarpey) with the AI, you'll give it as much information and have a
1:03:36
(Tom Tarpey) backward and forward conversation with think of it the these are mostly conversational (Tom Tarpey) models. So you want to treat it like it is. So you want to kind of have
1:03:44
(Tom Tarpey) a conversation, but you give it as much information as you can. So then (Tom Tarpey) it kind of semi-tutors you, but all you're doing really is instead of you having to search
1:03:52
(Tom Tarpey) the web. So you're replacing Google for web (Tom Tarpey) search and you're replacing you manually reading every single
1:04:00
(Tom Tarpey) book. So it's just speeding up your learning process. You're not using it to have a real (Tom Tarpey) opinion. You're the one with the opinion, but at least you then
1:04:08
(Tom Tarpey) have the correct knowledge thrown at you in the right way. (Tom Tarpey) So a lot of it is getting to summarize things. Use it to read the
1:04:16
(Tom Tarpey) docs. If you don't want to read all of the docs to find the thing what you want to (Tom Tarpey) find, pass the docs to it and say, "I need to find this specific
1:04:24
(Tom Tarpey) concept. Give it to, you know, summarize it. Tell me about it." But (Tom Tarpey) don't just ask the model to tell you about it because the model's probably just going to hallucinate, have
1:04:32
(Tom Tarpey) outofdate stuff, and not do the job. So, that's (Alexander Chan) Yeah. Yeah. Got - (Tom Tarpey) the general purpose there. Does that make
1:04:40
(Alexander Chan) you. Thank - (Tom Tarpey) sense? Awesome. Let's see who's next. (Tom Tarpey) to tell where is this? Uh I missed that.
1:04:48
(Alexander Chan) you. - (Tom Tarpey) Uh Grace I think is next. Could be out of (Grace Huang) Yes, thank you so much for talk. I was going to ask you if you have
1:04:56
(Grace Huang) any um like favorite local models or what your setup (Grace Huang) is in terms of your entire
1:05:04
(Grace Huang) background. Like do you have a flow of how you like to work (Tom Tarpey) order. Um most of my time is network security.
1:05:12
(Tom Tarpey) Um, so I tend to have very I got a lot - (Grace Huang) or (Tom Tarpey) of smaller quantized models I like to use and
1:05:20
(Tom Tarpey) it doesn't really matter which model it is directly as long as it's got (Tom Tarpey) a small enough base for me to then fine-tune it into what I want.
1:05:28
(Tom Tarpey) I use a lot of fine tuned stuff, but I don't use like a massive fine tune model. (Tom Tarpey) I use one for a specific use case. I got a little
1:05:36
(Tom Tarpey) prop um on (Tom Tarpey) This is just about to get deprecated,
1:05:44
(Tom Tarpey) but I've used this for quite some time. (Tom Tarpey) It's got 256 megabytes of
1:05:52
(Tom Tarpey) RAM, a 32-bit processor. It's an old version one Apple (Tom Tarpey) TV. This has got a small embedded Linux on there with a - (Grace Huang) Cool.
1:06:00
(Tom Tarpey) couple of models that are quantized, and it runs fast as (Tom Tarpey) heck. And this is great. I plug this into a network. All it does is it turns
1:06:08
(Tom Tarpey) on, it spiders the network, uses tools that are on (Tom Tarpey) there because it's got specific tools - (Grace Huang) Cool.
1:06:16
(Tom Tarpey) and does a penetration test for that local network there. I'll (Tom Tarpey) have four or five of these, plug them into different offices, leave
1:06:24
(Tom Tarpey) them going whilst I go off and do some manual recon and some other stuff and maybe the (Tom Tarpey) servers are doing other things. But things like this are
1:06:32
(Tom Tarpey) go-to. This one has an early llama model, I think, (Tom Tarpey) on it. And that's been fine-tuned. And I think
1:06:40
(Tom Tarpey) I've got one of the YOLO V1 for where (Tom Tarpey) it pulls any like images and infers information about the images on there and
1:06:48
(Tom Tarpey) stuff. And this does a full um like data (Tom Tarpey) collection and and pentest. Then it passes then it
1:06:56
(Tom Tarpey) automatically passes it to my server and then my server will collate that (Tom Tarpey) with a few larger models running on GPUs and
1:07:04
(Tom Tarpey) stuff and go off and build out the you know more inference from (Tom Tarpey) that and then I'll I'll have a dashboard and I'll just go through and tick off
1:07:12
(Tom Tarpey) what I want and then we'll I'll have another LLM build (Tom Tarpey) out the um the reports for me. Then we print off a nice
1:07:20
(Tom Tarpey) big chunky set of reports and then take that to a company and (Tom Tarpey) explain what what problems they got and the mitigations they can do. So
1:07:28
(Tom Tarpey) my use cases are usually very quant very much quantized models on (Tom Tarpey) small discrete systems. Nowadays you get a Raspberry Pi, it's going to be like
1:07:36
(Tom Tarpey) 50 billion times more powerful than this. So you know like loner about bigger (Tom Tarpey) things. So this is kind of getting deprecated. It's probably going to have Windows XP on it at some point
1:07:44
(Tom Tarpey) soon. So that's just But then you've got (Tom Tarpey) all different uh Yeah, I think I' got a nook over
1:07:52
(Tom Tarpey) here. Similar sort of thing. Lots of these little (Tom Tarpey) things. Um one sec
1:08:04
(Tom Tarpey) more. Okay. It's not always about the (Tom Tarpey) software. Sometimes it's more about the tools. - (Grace Huang) What?
1:08:12
(Tom Tarpey) So, a lot of the times for embedded stuff (Tom Tarpey) will um I actually have some LM models that will fit
1:08:20
(Tom Tarpey) on so much K. They've got like one bit (Tom Tarpey) quantized things and they work great for quick circuit
1:08:28
(Tom Tarpey) checks. So there's lots of different process you can do and there's there's (Tom Tarpey) things like the um picos you can shove Python
1:08:36
(Tom Tarpey) on there and do all sorts of inference and you don't nec and all you (Tom Tarpey) use the GPIO pins to shove them on some data so you've got like an SD card
1:08:44
(Tom Tarpey) reader and shove all your actual data on SD card. So there's so many (Tom Tarpey) different aspects to what you can use an LM for and it doesn't just have
1:08:52
(Tom Tarpey) to be coding as such. Um, but (Tom Tarpey) yeah. So, does that make any sense, - (Grace Huang) Yeah, I mean
1:09:00
(Grace Huang) uh seven maybe 50 (Grace Huang) 40%. It's very cool for sure. So, I I guess my
1:09:08
(Grace Huang) follow-up question I'll I'll only try and keep it quick, (Grace Huang) but when you say fine-tuning and then you give
1:09:16
(Tom Tarpey) Grace? - (Grace Huang) it um different tools, I guess how do you (Grace Huang) like how do you keep track across what the
1:09:24
(Grace Huang) specific um use case for each of the tools (Grace Huang) you're using? And when you decide like, oh, I need to find this or I need to give it an
1:09:32
(Grace Huang) extra tool or I need to start over on another piece of (Tom Tarpey) Well, majority times my my LM will do one thing and
1:09:40
(Tom Tarpey) do it really well. So, it might have one tool, two tools, maybe three at (Tom Tarpey) most. If I go over three, it's time to get a new LM - (Grace Huang) hardware.
1:09:48
(Tom Tarpey) because it must be a different use case. Like for instance, uh I'll (Tom Tarpey) have let's say redare um - (Grace Huang) Yeah.
1:09:56
(Tom Tarpey) GDB and maybe a headless uh gedra or something. There's (Tom Tarpey) three tools to do one job. Binary exploitation and
1:10:04
(Tom Tarpey) reverse engineering of binaries. That's it. So there's the tools it's got (Tom Tarpey) access to. And that LLM will be trained specifically to use
1:10:12
(Tom Tarpey) that and prompted to use that too. - (Grace Huang) Mhm. (Tom Tarpey) And the only time that will get pulled out, that's why I have so many laptops as well. One laptop does one
1:10:20
(Tom Tarpey) job, doesn't do anything else. I don't have like (Tom Tarpey) 50 different applications on one laptop. I have one application that does one thing really well or two
1:10:28
(Tom Tarpey) applications that does the same thing really well or work together in a - (Grace Huang) Cool. (Tom Tarpey) way. So if I need to do one thing, I'll grab that laptop. When I need to do another thing, I'll grab that
1:10:36
(Tom Tarpey) laptop. I will have generalist ones around as well (Tom Tarpey) for just usage. But in general, that that's I
1:10:44
(Tom Tarpey) tend to do a lot of specialized rather than generalist stuff. (Tom Tarpey) And I found fine-tuning I have that much on
1:10:52
(Tom Tarpey) prem that I don't use cloud to fine tune stuff because (Tom Tarpey) it's it works. There's a bigger up front cost and technically an
1:11:00
(Tom Tarpey) electricity cost. Um but overall (Tom Tarpey) it's a lot better for my use case to local and especially when I need to - (Grace Huang) Mhm.
1:11:08
(Tom Tarpey) do stop gap stuff. So uh some of my servers have to be stop gap because (Tom Tarpey) military and other things that have to happen where it's not allowed to touch
1:11:16
(Tom Tarpey) the internet or any sort of surface like that. (Tom Tarpey) So uh so does that kind of cover things - (Grace Huang) Yes. Thank
1:11:24
(Tom Tarpey) for awesome I think Jordan are you - (Grace Huang) you. Thank you so much. (Jordan Ballard) Yeah. So, uh, you've
1:11:32
(Jordan Ballard) officially joined Zach on my short list of most interesting people in the (Tom Tarpey) left? Yeah. - (Jordan Ballard) world. Uh, this
1:11:40
(Jordan Ballard) is a random question. Um, he says, Zach says he (Jordan Ballard) pushes he'll probably push over 20 billion,
1:11:48
(Jordan Ballard) uh, tokens this year. Do you have any concept of how (Tom Tarpey) probably actually - (Jordan Ballard) much you might
1:11:56
(Tom Tarpey) less than that even though I've probably got about I spend about 20 grand (Tom Tarpey) a month on AI
1:12:04
(Tom Tarpey) personally and then we've got the I think we got a Claude subscription (Tom Tarpey) and max with work and stuff, but
1:12:12
(Tom Tarpey) most of my tokens are local. So when you say push tokens, (Tom Tarpey) it's case of, you know, it's all free if you
1:12:20
(Tom Tarpey) like. But no, I'd say I'm probably only in the like (Tom Tarpey) maybe 1 billion to two billion cuz a lot of my stuff requires me to manually
1:12:28
(Tom Tarpey) do things. Do you know what I mean? And that 1 (Tom Tarpey) billion to two billion is probably just for
1:12:36
(Tom Tarpey) gauntlet. the other stuff not so much or at least (Tom Tarpey) I don't track it because it's all on prem or stuff like
1:12:44
(Tom Tarpey) that. Um I like to make minimal use of (Tom Tarpey) tokens. So I'll use minimal amount of tokens to get the job done. You know what I
1:12:52
(Tom Tarpey) mean? I come from I in my family you either (Tom Tarpey) join the military or or you're a criminal cuz like below poverty
1:13:00
(Tom Tarpey) class, you know what I mean? So I come from that. So every penny, (Tom Tarpey) every single cent is like a million dollars. So you got to make it work like a
1:13:08
(Tom Tarpey) million dollars. So that's kind of the background where I come from. And military wise, you've (Tom Tarpey) just got to work with what you've got. Most of the time, you don't have weapons yourself. You get dropped
1:13:16
(Tom Tarpey) somewhere, you don't have rations. You're taking the enemy's rations, the enemy's weapons, and doing what you got (Tom Tarpey) to do. So you don't you've got it's more
1:13:24
(Tom Tarpey) about resource management for me. So mine's probably a slightly different (Tom Tarpey) approach, but there are times where I'll just go, you know what, throw money at
1:13:32
(Tom Tarpey) the problem. But usually I'll throw hardware at the problem as opposed to (Tom Tarpey) software. So I'll go take 20 grand 30 grand and throw that at the problem in - (Jordan Ballard) Yeah, that makes
1:13:40
(Tom Tarpey) hardware and rather than 20 30 grand on piece of (Tom Tarpey) software most of the time or even more
1:13:48
(Tom Tarpey) so it's usually some processes cheaper to pay a person to do (Tom Tarpey) something is to pay LLM. How crazy is - (Jordan Ballard) sense.
1:13:56
(Tom Tarpey) that? I found that out just over time and that that's a (Tom Tarpey) thing. And it is crazy to me how people are sometimes cheaper than they
1:14:04
(Jordan Ballard) at do you know if at any point during these 10 (Jordan Ballard) weeks we're going to do anything on um token optimization
1:14:12
(Tom Tarpey) are. I don't I don't remember what's in the actual exact (Tom Tarpey) curriculum. It changes so often, so I probably wouldn't know for definite, but I
1:14:20
(Tom Tarpey) I think the person probably Aaron or Byron to ask about that, they're probably doing a lot of (Tom Tarpey) the curriculum development stuff at this point. Um, but
1:14:28
(Tom Tarpey) yeah, I I do know uh next you're probably doing doing a little bit of a - (Jordan Ballard) Awesome. (Tom Tarpey) refactor or or a build on top next week, I'm guessing with a few things.
1:14:36
(Tom Tarpey) I'm not going to I'm not going to do spoilers for that though. I'll let Byron tell you about that stuff cuz (Tom Tarpey) that's going to be hopefully exciting and possibly a bit stressful,
1:14:44
(Tom Tarpey) but it's an interesting thing if it comes up. But yeah, (Tom Tarpey) did that cover most of the stuff what you wanted or any
1:14:52
(Tom Tarpey) Awesome. Okay. All right, Byron. (Tom Tarpey) Okay. Uh, I think we've kind of gone over by like 20 odd minutes, I think. Have
1:15:00
(Tom Tarpey) we? Or am I mentioning things? Bit crazy, but (Tom Tarpey) it's been awesome. Uh, I think I'm going to close out now just to
1:15:08
(Tom Tarpey) give you guys time to take a bit of time to decompress and get on with your (Tom Tarpey) stuff. Um, I'll be around. I'll just be doing
1:15:16
(Tom Tarpey) engineering tasks, but if there's anything mad, just message in the um (Tom Tarpey) chat, maybe open up a little thread where I drop the um
1:15:24
(Tom Tarpey) links and we can go over stuff and if you need a few resources, I might have a few (Tom Tarpey) interesting little prompts and things. But again, I'm usually
1:15:32
(Tom Tarpey) fairly accessible, so just at me at some point and anything (Tom Tarpey) mad. Other than that, have a great one everyone and it's been awesome
1:15:40
(Tom Tarpey) to meet you all. Was that a wave or is that hand up, Dom, (Dominic Antonelli) Just - (Tom Tarpey) Nick?
1:15:48
(Dominic Antonelli) mentioning that Byron says everyone should stay on for a minute. - (Tom Tarpey) All right, cool. Sorry about (Byron Mackay) Yep. Hope you're all good, Tom. Uh, hey - (Tom Tarpey) any
1:15:56
(Byron Mackay) everybody. Thanks, Tom, for that lecture. It's a It's something - (Tom Tarpey) comments. I'll stop (Byron Mackay) that we've actually surprisingly seen a lot of requests for is
1:16:04
(Byron Mackay) migrations like this from one place to another. (Byron Mackay) Uh it's it's a uh yeah it's an
1:16:12
(Byron Mackay) interesting interesting thing that uh we're seeing a lot more of just because it's it is (Byron Mackay) so much more practical and viable to
1:16:20
(Byron Mackay) accomplish. So as such uh you've got a new requirement - (Tom Tarpey) sharing. (Byron Mackay) this
1:16:28
(Byron Mackay) week. Here it is. This is in the portal. (Byron Mackay) So, you're all gonna do some migrations on top of
1:16:36
(Byron Mackay) what you're doing this week already. Uh, Open (Byron Mackay) EMR has actually traditionally had a lot of UX issues with it
1:16:44
(Byron Mackay) and they've made those changes. Um, but it's all (Byron Mackay) still in PHP and so you're going to now migrate
1:16:52
(Byron Mackay) part, not all but a small part of the (Byron Mackay) application from PHP to a framework or language of your choice.
1:17:00
(Byron Mackay) uh your job will be to go through it's has to do with the (Byron Mackay) patient dashboard. So you're going to go through
1:17:08
(Byron Mackay) and make those changes. This is uh you're going to make (Byron Mackay) varying changes to the authentication, the patient header, the clinical
1:17:16
(Byron Mackay) cards. Um and then you'll have one additional section of your choice (Byron Mackay) that you'll need to make. Uh all this must be done
1:17:24
(Byron Mackay) and be part of your deliverable by Sunday at noon. (Byron Mackay) And I just wanted to highlight that there is a patient dashboard migration MD file that I
1:17:32
(Byron Mackay) want you to craft that explains why you chose the what you (Byron Mackay) chose as the reason why you made that
1:17:40
(Byron Mackay) transition. So uh again this is in the portal so you can go grab it from (Byron Mackay) there but we're expecting this to be part of the um not
1:17:48
(Byron Mackay) part of the early submission but part of the final (Byron Mackay) submission. Uh, but I would not take that to say I
1:17:56
(Byron Mackay) don't have to work on it until after the early submission. I would work on it right (Byron Mackay) away. All right, that's my announcement. Ben,
1:18:04
(Benjamin Cohen) Uh yeah. So given that we're doing (Benjamin Cohen) this uh update to the patient dashboard um can that be like
1:18:12
(Benjamin Cohen) the entire experience at that point or do we need to (Benjamin Cohen) have our updated like login experience and then um - (Byron Mackay) question.
1:18:20
(Benjamin Cohen) our updated you know patient various experiences but then (Benjamin Cohen) also all of the experiences that we're not
1:18:28
(Benjamin Cohen) updating that are built into open EMR. (Byron Mackay) So the question was do let me rephrase this. You're asking
1:18:36
(Benjamin Cohen) are well basically it's like it's almost like - (Byron Mackay) if when you say this can be the only (Benjamin Cohen) we have a V3 of a site and we're trying to make the V4 of the site and the
1:18:44
(Benjamin Cohen) question is can we simply have the minimum viable (Benjamin Cohen) features to make the V4 work or are you saying that it should have all
1:18:52
(Benjamin Cohen) the V4 stuff in the site but then the V3 stuff still needs to be (Benjamin Cohen) accessible as in it's a bit of a Frankenstein - (Byron Mackay) experience. Bit of a bit of a Frankenstein.
1:19:00
(Byron Mackay) Bit of a Frankenstein. The V3 stuff still needs to be available uh (Byron Mackay) for you to access. So every everything else needs to be there, but this part
1:19:08
(Byron Mackay) needs to be available. Imagine that this is a uh small portion that (Byron Mackay) you want to move over to assess that this is something you want to do moving forward kind of
1:19:16
(Benjamin Cohen) up. Okay. But to that point, um let's say like I'm updating the patient (Benjamin Cohen) portal. Uh medications, allergies, this that there's lots and lots of things on
1:19:24
(Benjamin Cohen) the patient portal that it sounds like we wouldn't update. And just as someone who's worked in front (Benjamin Cohen) end for a long time, that's an basically you update an entire page at - (Byron Mackay) thing.
1:19:32
(Benjamin Cohen) a time. You don't update small bits and then leave other bits in the past. It (Benjamin Cohen) it look it's actually much worse as a user - (Byron Mackay) I see. I see what you're saying. So,
1:19:40
(Byron Mackay) you're saying like, "Hey, this might be part of the page, but it's not going to be the whole page. It's going to (Benjamin Cohen) experience. Right. Exactly. As in the the patient page is kind - (Byron Mackay) be like 20 other
1:19:48
(Benjamin Cohen) of the main page I imagine a lot of people are working in. And (Benjamin Cohen) uh there's cards and you could certainly update the - (Byron Mackay) components.
1:19:56
(Benjamin Cohen) medication card, the you know vitals cards, various things like that. (Benjamin Cohen) But in terms of updating all the cards, that's like 33 things or
1:20:04
(Byron Mackay) Right. Right. Okay. I see what you're saying. So don't worry about the rest of the (Byron Mackay) cards. Just the cards that are specified here and then the rest you can leave
1:20:12
(Benjamin Cohen) something. - (Byron Mackay) off. So the page should only be in one framework. I think that's what the idea you're getting as this (Byron Mackay) page should only be if you let's say do React. This page should only be
1:20:20
(Byron Mackay) React and no PHP frontend component should be included with it. (Benjamin Cohen) Right. Ex. Yeah. Okay. That was my question essentially. - (Byron Mackay) just these
1:20:28
(Benjamin Cohen) Thanks. - (Byron Mackay) pieces. Got it. Got it. Okay, cool. Yep. (David Taylor) Uh that actually answered some of my questions. Um but
1:20:36
(David Taylor) uh so the patient portal is I haven't I haven't (David Taylor) delved into the patient portal at all because I've been doing the PCP user story and
1:20:44
(David Taylor) so that is a separate entry point or is that the same login that the patient (David Taylor) would just it's just the patient sees it
1:20:52
(David Taylor) differently. I guess - (Byron Mackay) David. Uh, good (David Taylor) that's part of my research then. Yeah. - (Byron Mackay) question. Primary search. There you go. Yeah. Yep.
1:21:00
(David Taylor) Um, okay. And yeah, then my other question was are porting all the features - (Byron Mackay) Go (David Taylor) over directly, but it sounds like just the ones that are listed - (Byron Mackay) find just just
1:21:08
(David Taylor) here. Okay, sounds good. - (Byron Mackay) the ones that are listed. Yeah, (Erick Andrade) Yeah, sorry. Um, I
1:21:16
(Erick Andrade) already dropped and then I was a bit late at the beginning of this. So, this is for this (Byron Mackay) Eric. That's right. final submission. - (Erick Andrade) week. Uh, and like the final
1:21:24
(Byron Mackay) I won't worry about it for early. Um I want to make sure you focus on the other (Byron Mackay) things, but for final this will have to be - (Erick Andrade) submission and this
1:21:32
(Erick Andrade) is just a is it the documentation or it's actually the actual (Byron Mackay) done actual migration with some with documentation talking
1:21:40
(Byron Mackay) about your decisions. - (Erick Andrade) migration. Okay. (Byron Mackay) Okay, - (Matthew Daw) Uh, sorry.
1:21:48
(Byron Mackay) Matthew. - (Matthew Daw) I just want to be super clear. Um, we're this this can be like (Matthew Daw) an entirely different website. Like I don't have to be able to navigate to the old pages and the new
1:21:56
(Byron Mackay) that that - (Matthew Daw) pages at the same time. They can just be completely separated, (Byron Mackay) part I do want you to be able to do. I still want to be part
1:22:04
(Byron Mackay) of the codebase. I still want to be part of the full experience so you can (Byron Mackay) navigate away and go to different pages, right? But this page
1:22:12
(Byron Mackay) itself should be completely migrated - (Matthew Daw) right? That's it. (Byron Mackay) over. - (Matthew Daw) Okay.
1:22:20
(Nayan Bhut) Um, for the authentication, are (Nayan Bhut) we uh I don't know. I think you answered this, but I just didn't get it. But
1:22:28
(Nayan Bhut) uh for authentication do we have to add do we have to (Nayan Bhut) add the open id connect or do we just replace the
1:22:36
(Byron Mackay) N. So there shouldn't be any - (Nayan Bhut) existing off (Byron Mackay) API changes you make. So there should be systems that are
1:22:44
(Byron Mackay) already in place that handle whatever whatever the authentication (Byron Mackay) is that they currently have for Open EMR. That's what I want you. It's really just - (Nayan Bhut) system.
1:22:52
(Byron Mackay) the page. That's all the front end and then hooking it up obviously to the API. (Byron Mackay) But the API itself shouldn't be changing just the way you interact with it
1:23:00
(Byron Mackay) from the front - (Nayan Bhut) Okay. Understood. Thank (Byron Mackay) end. All - (Tom Tarpey) Uh, I've got a
1:23:08
(David Taylor) Uh yeah, - (Byron Mackay) right. - (Tom Tarpey) couple of Oh, somebody's got their hand up (David Taylor) sorry just one more question. I I think I might have misunderstood. Is this a patient user
1:23:16
(David Taylor) story like from the patient logging in or is this just the (David Taylor) patient dashboard as a as a primary care physician would see it like their
1:23:24
(David Taylor) patient view of their own patients? (Byron Mackay) I believe I I read this reading it as
1:23:32
(Byron Mackay) uh this is what the clinician sees. (David Taylor) Okay. All - (Byron Mackay) Now if if anybody feels strongly otherwise I'm happy to have a discussion
1:23:40
(Byron Mackay) and talk it through to make sure we are aligned there. But that's what I was (David Taylor) right. I mean, I would rather have one user point of view as well. - (Byron Mackay) intending. Sure.
1:23:48
(David Taylor) So, (Byron Mackay) Cool. - (Tom Tarpey) Right. Yeah. I just wanted to say shout a um there's going to be
1:23:56
(Tom Tarpey) possibly a few gotchas. uh depending on your system (Tom Tarpey) when you actually try and do the connection and make the
1:24:04
(Tom Tarpey) client stuff to be able to connect to this via the API and enable the (Tom Tarpey) API. When you're making the client, sometimes the UI kind of doesn't
1:24:12
(Tom Tarpey) want you to do it. If that happens, you may have to (Tom Tarpey) go right click on it while you're in the in the actual
1:24:20
(Tom Tarpey) application, go into the console in your (Tom Tarpey) browser and start doing JavaScript to do the same process. So,
1:24:28
(Tom Tarpey) you might have to do a little bit of research on that as a caveat of it (Tom Tarpey) being an old thing that's quite brittle.
1:24:36
(Tom Tarpey) Just as a heads up for everyone, (Byron Mackay) All - (Tom Tarpey) that's just something to have on - (Jesse Walberg) Can Can you say that again in a maybe a different
1:24:44
(Byron Mackay) right. - (Tom Tarpey) your uh let's imagine you go to connect, right? Imagine - (Jesse Walberg) way? (Tom Tarpey) you've built an application. You've got to connect that kind of like how you would
1:24:52
(Tom Tarpey) in let's say Slack, making a Slack app or something. Inside it, (Tom Tarpey) it's got an ability to add applications and
1:25:00
(Tom Tarpey) that's how you would connect it. So, it will give you like a client ID and (Tom Tarpey) uh and a client secret to connect it. Now, there
1:25:08
(Tom Tarpey) is a form on there to do that with a submit. If you fill all the stuff in, (Tom Tarpey) sometimes you click on it, it just does nothing. Other times it'll crash. Other
1:25:16
(Tom Tarpey) times it'll have other weird quirks. Sometimes it'll just work, but (Tom Tarpey) majority of the time I've noticed across the board is it breaks somewhere along the
1:25:24
(Tom Tarpey) line. In those times, all you do is you're still on that page, you (Tom Tarpey) rightclick, inspect, open up the um console, and start doing
1:25:32
(Tom Tarpey) some JavaScript injection to get the job (Tom Tarpey) done. So, you just got to figure out the
1:25:40
(Tom Tarpey) correct functionality to do what the form was (Tom Tarpey) doing, but in JavaScript, because you're already um
1:25:48
(Tom Tarpey) authenticated, you make sure you're still authenticated and logged in as admin when you're doing (Tom Tarpey) this. And then you can just send the things like using no fetch
1:25:56
(Tom Tarpey) command, hit the API and have it do what it needs to to make the (Tom Tarpey) things, but only once you've got the API enabled. And you'll find that
1:26:04
(Tom Tarpey) some of the docs are slightly deprecated. So you'll look and you'll have to poke (Tom Tarpey) around in the admin uh menu. Usually in
1:26:12
(Tom Tarpey) config and system are your two main areas just as a heads up. (Tom Tarpey) Yeah, these are just annoyances that you're going to come up with. So I thought best to kind of
1:26:20
(Tom Tarpey) air them out now. Yeah, I think (Tom Tarpey) we'll close out now because we've gone like over half the
1:26:28
(Tom Tarpey) um but it's been awesome as always. Have a good (Raq Robinson) Thank - (Tom Tarpey) one
1:26:36
(Raq Robinson) you. (Tom Tarpey) everyone.