class_name NoteManager
extends Node

const NOTE_SCENE = preload("res://Blueprints/Item/note.tscn")

func spawn_note(pos:Vector2 ,content:String , scene : Node)->void :
	var new_scene = NOTE_SCENE.instantiate()
	var new_node = new_scene.get_child(0) as note_button
	new_node.setup(pos,content)
	scene.add_child(new_scene)
	
	
	 
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
