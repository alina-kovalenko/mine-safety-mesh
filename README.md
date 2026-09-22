
# Mine Safety Predictive Mesh App

This project is a prototype of a mine safety monitoring system based on sensor data, mesh communication and predictive analysis.

The main idea is to collect data from different nodes placed inside a mine and use this information to monitor the current situation. Each node represents a part of the mine and can exchange data with nearby nodes through a mesh network.

The system is designed to identify three main states:

* Safe
* Potentially dangerous
* Dangerous

The application also analyzes changes in sensor values over time. This makes it possible to detect not only the current dangerous area, but also possible changes in the situation and the direction in which the danger may spread.

## Main features

* monitoring of mine nodes
* visualization of sensor data
* safety status for each node
* prediction of dangerous conditions
* analysis of neighboring nodes
* visualization of possible danger propagation
* mesh network representation
* web-based interface

## How it works

Sensor data is received from monitoring nodes located in different parts of the mine.

The data is processed and used to determine the current safety level of each node.

If abnormal changes are detected, the system analyzes nearby nodes and previous values to estimate how the situation may develop.

The result is shown in the web application, where the user can see the condition of the mine and areas that may require attention.

## Project structure

The project contains a web interface for displaying mine nodes, sensor information and prediction results.

The current version is a prototype developed to demonstrate the concept of predictive mine safety monitoring.

## Technologies

* HTML
* CSS
* JavaScript
* Python
* Machine Learning
* Mesh network concept

## Purpose

The purpose of this project is to show how sensor monitoring, mesh communication and predictive analysis can be combined in one system for underground mine safety.

The system is currently a prototype and is intended for research and demonstration purposes.

