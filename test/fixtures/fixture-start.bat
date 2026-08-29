@echo off
cd /d %~dp0
rem Test fixture: spawn fixture-server.js in its own minimized window (like real-world bats
rem that use `start` to detach grandchild processes), then exit immediately.
start "wb-fixture" /min node fixture-server.js
exit
